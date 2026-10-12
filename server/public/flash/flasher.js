'use strict';

// utility ships as an APP_TYPE=BOOT_SRAM image: it lives in QSPI at
// 0x90040000, not internal flash at 0x08000000. Upstream's Programmer picks
// its interface with a literal name match on "0x08000000", which selects the
// wrong region on this device.
const QSPI_APP_ADDRESS = 0x90040000;
const DAISY_VENDOR_ID = 0x0483;
const TRANSFER_SIZE = 1024;

const el = (id) => document.getElementById(id);
const state = { device: null, firmware: null, release: null, prefetch: null, devicePresent: false };

function setStatus(msg, kind) {
  const node = el('status');
  node.textContent = msg;
  node.className = 'status' + (kind ? ' status--' + kind : '');
}

function setProgress(done, total) {
  const bar = el('progress');
  if (!total) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.value = done;
  bar.max = total;
}

function webusbSupported() {
  return typeof navigator !== 'undefined' && navigator.usb && typeof navigator.usb.requestDevice === 'function';
}

// Interfaces are chosen by parsing each DfuSe memory descriptor and asking
// which one actually contains the app address. Matching on the descriptor
// string would break the moment the bootloader reworded it.
function interfaceHoldsAddress(intf, address) {
  if (!intf.name) return false;
  let info;
  try {
    info = dfuse.parseMemoryDescriptor(intf.name);
  } catch (e) {
    return false;
  }
  if (!info || !info.segments) return false;
  return info.segments.some((seg) => address >= seg.start && address < seg.end);
}

async function fixInterfaceNames(rawDevice, interfaces) {
  if (!interfaces.some((intf) => intf.name == null)) return;
  const temp = new dfu.Device(rawDevice, interfaces[0]);
  await temp.device_.open();
  await temp.device_.selectConfiguration(1);
  const mapping = await temp.readInterfaceNames();
  await temp.close();
  for (const intf of interfaces) {
    if (intf.name === null) {
      const cfg = intf.configuration.configurationValue;
      const num = intf['interface'].interfaceNumber;
      const alt = intf.alternate.alternateSetting;
      intf.name = mapping[cfg][num][alt];
    }
  }
}

// Devices the user has authorised once on this origin come back without any
// prompt. requestDevice() is the only call that can show the picker, and the
// spec requires it to — so it is the fallback, not the default path.
async function authorisedDaisy() {
  if (!navigator.usb.getDevices) return null;
  try {
    const devices = await navigator.usb.getDevices();
    return devices.find((d) => d.vendorId === DAISY_VENDOR_ID) || null;
  } catch (e) {
    return null;
  }
}

async function connect(preauthorised) {
  const raw = preauthorised ||
    await navigator.usb.requestDevice({ filters: [{ vendorId: DAISY_VENDOR_ID }] });
  const interfaces = dfu.findDeviceDfuInterfaces(raw);
  if (interfaces.length === 0) throw new Error('That device exposes no USB DFU interface.');

  await fixInterfaceNames(raw, interfaces);

  let chosen = interfaces.find((i) => interfaceHoldsAddress(i, QSPI_APP_ADDRESS));
  if (!chosen) {
    const names = interfaces.map((i) => i.name || '(unnamed)').join(', ');
    // Both the Daisy bootloader and the STM32 ROM bootloader enumerate as
    // 0483:df11, so VID/PID cannot tell them apart — only the memory map can.
    // Landing here almost always means BOOT was held down at reset, which
    // starts the ROM bootloader (internal flash only).
    throw new Error(
      'This device is not offering the QSPI region the firmware needs. Press RESET on ' +
      'its own — without holding BOOT — and try again. (Saw: ' + names + ')'
    );
  }

  const isDfuse = chosen.alternate.interfaceProtocol === 0x02;
  let device = isDfuse ? new dfuse.Device(raw, chosen) : new dfu.Device(raw, chosen);

  device.logInfo = (m) => console.log(m);
  device.logWarning = (m) => console.warn(m);
  device.logError = (m) => console.error(m);
  device.logProgress = (done, total) => setProgress(done, total);

  await device.open();
  if (device instanceof dfuse.Device) device.startAddress = QSPI_APP_ADDRESS;
  return device;
}

async function loadRelease() {
  const res = await fetch('/flash/release.json', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not read release info (' + res.status + ').');
  return res.json();
}

async function loadFirmware() {
  const res = await fetch('/flash/firmware.bin', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not download firmware (' + res.status + ').');
  return res.arrayBuffer();
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function flash() {
  const button = el('flash');
  button.disabled = true;
  try {
    // The DFU window is ~2s wide, so nothing slow may sit between the click
    // and the device picker. The download was started at page load; by now it
    // is almost always already resolved.
    if (!state.prefetch) state.prefetch = loadFirmware();
    setStatus('Preparing…');
    state.firmware = await state.prefetch;

    // The release publishes a checksum; verifying it here means a truncated or
    // proxied-wrong download fails before it reaches the device rather than
    // after.
    if (state.release && state.release.sha256) {
      const got = await sha256Hex(state.firmware);
      if (got !== state.release.sha256) {
        throw new Error('Checksum mismatch — refusing to flash. Expected ' +
          state.release.sha256.slice(0, 12) + '… got ' + got.slice(0, 12) + '…');
      }
    }

    const known = await authorisedDaisy();
    setStatus(known ? 'Connecting…' : 'Select your device in the browser prompt…');
    state.device = await connect(known);

    setStatus('Writing to QSPI 0x' + QSPI_APP_ADDRESS.toString(16) + '…');
    await state.device.do_download(TRANSFER_SIZE, state.firmware, false);

    setProgress(0, 0);
    setStatus('Done. Power-cycle the pedal to run the new firmware.', 'ok');
  } catch (err) {
    setProgress(0, 0);
    setStatus(String(err && err.message ? err.message : err), 'error');
  } finally {
    button.disabled = false;
    if (state.device) { try { await state.device.close(); } catch (e) { /* already gone */ } }
    state.device = null;
  }
}

// The pedal only sits in DFU briefly, and nothing on screen told the user
// whether it was there. An authorised device raises connect/disconnect, so the
// page can simply say so.
function setDeviceState(present) {
  state.devicePresent = present;
  const node = el('device');
  if (!node) return;
  node.hidden = false;
  node.textContent = present ? 'Pedal detected in update mode' : 'Pedal not detected';
  node.className = 'device' + (present ? ' device--ok' : '');
}

async function watchForDevice() {
  if (!navigator.usb.addEventListener) return;
  setDeviceState(!!(await authorisedDaisy()));
  navigator.usb.addEventListener('connect', (e) => {
    if (e.device && e.device.vendorId === DAISY_VENDOR_ID) setDeviceState(true);
  });
  navigator.usb.addEventListener('disconnect', (e) => {
    if (e.device && e.device.vendorId === DAISY_VENDOR_ID) setDeviceState(false);
  });
}

async function init() {
  if (!webusbSupported()) {
    el('unsupported').hidden = false;
    el('app').hidden = true;
    return;
  }
  el('app').hidden = false;
  el('flash').addEventListener('click', flash);
  watchForDevice();

  try {
    state.release = await loadRelease();
    el('version').textContent = state.release.tag;
    el('size').textContent = state.release.size ? (state.release.size + ' bytes') : '—';
    const link = el('source');
    link.href = state.release.source_url;
    link.textContent = state.release.tag;
    el('release-info').hidden = false;

    state.prefetch = loadFirmware();
    state.prefetch
      .then(() => setStatus('Firmware ready. Press RESET on the pedal, then Flash.'))
      .catch((e) => setStatus('Could not pre-load firmware: ' + e.message, 'error'));
  } catch (err) {
    setStatus('Could not reach the firmware release: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
