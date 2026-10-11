# Regression test for the /flash access gate.
#
# The gate is middleware rather than a `before` filter because Sinatra serves
# public/ from inside the app: a filter would leave /flash/*.js and the firmware
# proxy reachable without credentials. This test exists to prove that ordering
# holds, so a future refactor to a `before` filter fails here instead of
# silently publishing the firmware.
#
# Usage: bundle exec ruby test_flash_gate.rb

ENV['FLASHER_USER'] ||= 'friend'
ENV['FLASHER_PASSWORD'] ||= 'hunter2'
ENV.delete('FIRMWARE_TOKEN')
ENV.delete('GITHUB_TOKEN')

require 'rack'
require_relative 'server'

Sinatra::Application.set :run, false
Sinatra::Application.set :public_folder, File.expand_path('public', __dir__)
Sinatra::Application.set :environment, :test

REQ = Rack::MockRequest.new(Sinatra::Application)

def creds(user, pass)
  'Basic ' + ["#{user}:#{pass}"].pack('m0')
end

FAILURES = []

def check(label, actual, expected)
  ok = Array(expected).include?(actual)
  FAILURES << "#{label}: expected #{Array(expected).join('/')}, got #{actual}" unless ok
  puts format('  %-52s %s (%s)', label, ok ? 'OK' : 'FAIL', actual)
end

GATED = ['/flash', '/flash/', '/flash/index.html', '/flash/flasher.js',
         '/flash/dfu.js', '/flash/dfuse.js', '/flash/release.json',
         '/flash/firmware.bin'].freeze

puts 'unauthenticated requests are refused:'
GATED.each { |p| check(p, REQ.get(p).status, 401) }

puts 'the public site is untouched:'
check('/', REQ.get('/').status, 200)
check('/css/leumas.css', REQ.get('/css/leumas.css').status, 200)

puts 'wrong credentials are refused:'
check('/flash wrong password', REQ.get('/flash', 'HTTP_AUTHORIZATION' => creds('friend', 'nope')).status, 401)
check('/flash wrong user', REQ.get('/flash', 'HTTP_AUTHORIZATION' => creds('nobody', 'hunter2')).status, 401)
check('/flash empty', REQ.get('/flash', 'HTTP_AUTHORIZATION' => creds('', '')).status, 401)

puts 'correct credentials pass the gate:'
good = { 'HTTP_AUTHORIZATION' => creds('friend', 'hunter2') }
check('/flash', REQ.get('/flash', good).status, 200)
check('/flash/flasher.js', REQ.get('/flash/flasher.js', good).status, 200)
# No FIRMWARE_TOKEN is set, so these must fail at the GitHub step (502), not at
# the gate — which is what proves the gate let them through.
check('/flash/release.json (no token -> 502)', REQ.get('/flash/release.json', good).status, 502)
check('/flash/firmware.bin (no token -> 502)', REQ.get('/flash/firmware.bin', good).status, 502)

puts 'the gate fails closed when unconfigured:'
saved = ENV.delete('FLASHER_PASSWORD')
check('/flash with FLASHER_PASSWORD unset', REQ.get('/flash').status, 503)
check('/flash with creds but unset config', REQ.get('/flash', good).status, 503)
ENV['FLASHER_PASSWORD'] = saved

puts
if FAILURES.empty?
  puts "PASS  flash gate: #{GATED.length} gated paths, public site unaffected"
  exit 0
else
  FAILURES.each { |f| puts "FAIL  #{f}" }
  exit 1
end
