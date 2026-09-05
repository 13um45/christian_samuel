'use strict';

// utility ships as an APP_TYPE=BOOT_SRAM image: it lives in QSPI at
// 0x90040000, not internal flash at 0x08000000. Upstream's Programmer picks
// its interface with a literal name match on "0x08000000", which selects the
// wrong region on this device.
const QSPI_APP_ADDRESS = 0x90040000;
const DAISY_VENDOR_ID = 0x0483;
const TRANSFER_SIZE = 1024;

const el = (id) => document.getElementById(id);
const state = { device: null, firmware: null, release: null };

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

async function connect() {
  const raw = await navigator.usb.requestDevice({ filters: [{ vendorId: DAISY_VENDOR_ID }] });
  const interfaces = dfu.findDeviceDfuInterfaces(raw);
  if (interfaces.length === 0) throw new Error('That device exposes no USB DFU interface.');

  await fixInterfaceNames(raw, interfaces);

  let chosen = interfaces.find((i) => interfaceHoldsAddress(i, QSPI_APP_ADDRESS));
  if (!chosen) {
    const names = interfaces.map((i) => i.name || '(unnamed)').join(', ');
    throw new Error(
      'No DFU interface covers 0x' + QSPI_APP_ADDRESS.toString(16) + '. Saw: ' + names +
      '. That usually means the board is in the STM32 ROM bootloader (internal flash only) ' +
      'rather than the Daisy bootloader.'
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
    setStatus('Fetching the latest firmware…');
    state.firmware = await loadFirmware();

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

    setStatus('Select your device in the browser prompt…');
    state.device = await connect();

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

async function init() {
  if (!webusbSupported()) {
    el('unsupported').hidden = false;
    el('app').hidden = true;
    return;
  }
  el('app').hidden = false;
  el('flash').addEventListener('click', flash);

  try {
    state.release = await loadRelease();
    el('version').textContent = state.release.tag;
    el('size').textContent = state.release.size ? (state.release.size + ' bytes') : '—';
    const link = el('source');
    link.href = state.release.source_url;
    link.textContent = state.release.tag;
    el('release-info').hidden = false;
  } catch (err) {
    setStatus('Could not reach the firmware release: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
