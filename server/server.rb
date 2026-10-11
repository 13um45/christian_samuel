require 'sinatra'
require 'net/http'
require 'json'
require 'uri'

FIRMWARE_REPO = ENV.fetch('FIRMWARE_REPO', '13um45/utility')

# Pinned rather than inferred. Sinatra derives its root from the call stack,
# which Ruby 4.0's require shim perturbs — the app then resolves public_folder
# under the Ruby install and 404s every static asset. Explicit here so the site
# survives a Ruby upgrade.
set :public_folder, File.expand_path('public', __dir__)

# Path-scoped Basic auth. This is middleware rather than a `before` filter on
# purpose: Sinatra serves public/ from inside the app, so a filter would let
# anyone fetch /flash/*.js and the firmware proxy directly. Middleware runs
# ahead of static serving and closes that hole.
#
# Fails closed — with FLASHER_USER or FLASHER_PASSWORD unset, /flash is
# unreachable rather than open.
class FlashGate
  REALM = 'utility firmware'.freeze

  def initialize(app, prefix)
    @app = app
    @prefix = prefix
  end

  def call(env)
    return @app.call(env) unless env['PATH_INFO'].to_s.start_with?(@prefix)

    user = ENV['FLASHER_USER']
    pass = ENV['FLASHER_PASSWORD']
    return unconfigured if user.nil? || user.empty? || pass.nil? || pass.empty?

    auth = Rack::Auth::Basic::Request.new(env)
    return challenge unless auth.provided? && auth.basic? && auth.credentials

    given_user, given_pass = auth.credentials
    ok = secure_eq(given_user.to_s, user) & secure_eq(given_pass.to_s, pass)
    return challenge unless ok

    @app.call(env)
  end

  private

  # Compares both fields every time so a wrong username costs the same as a
  # wrong password.
  def secure_eq(a, b)
    Rack::Utils.secure_compare(a, b)
  rescue StandardError
    false
  end

  def challenge
    [401,
     { 'Content-Type' => 'text/plain', 'WWW-Authenticate' => %(Basic realm="#{REALM}") },
     ["Authentication required.\n"]]
  end

  def unconfigured
    [503,
     { 'Content-Type' => 'text/plain' },
     ["Flasher is not configured: FLASHER_USER / FLASHER_PASSWORD are unset.\n"]]
  end
end

use FlashGate, '/flash'

get '/' do
  File.read('public/index.html')
end

get '/flash' do
  send_file File.join(settings.public_folder, 'flash', 'index.html')
end

# Release metadata for the page. The firmware repo is private, so the browser
# can never reach the GitHub API itself — the token stays here.
get '/flash/release.json' do
  content_type :json
  release = latest_release
  return halt(502, { error: release[:error] }.to_json) if release[:error]

  {
    tag: release[:tag],
    published_at: release[:published_at],
    size: release[:size],
    source_url: "https://github.com/#{FIRMWARE_REPO}/tree/#{release[:tag]}",
    sha256: release[:sha256]
  }.to_json
end

# Streams the firmware itself. Behind the same gate as everything else under
# /flash, so an unauthenticated visitor cannot pull the binary directly.
get '/flash/firmware.bin' do
  release = latest_release
  halt(502, release[:error].to_s) if release[:error]
  halt(502, 'No utility.bin on the latest release.') unless release[:asset_url]

  body = gh_get(release[:asset_url], accept: 'application/octet-stream')
  halt(502, 'Could not download firmware from GitHub.') unless body

  content_type 'application/octet-stream'
  headers 'Content-Disposition' => %(attachment; filename="utility.bin")
  body
end

private

def gh_token
  ENV['FIRMWARE_TOKEN'] || ENV['GITHUB_TOKEN']
end

def gh_get(url, accept: 'application/vnd.github+json', limit: 5)
  return nil if limit.zero?

  uri = URI(url)
  req = Net::HTTP::Get.new(uri)
  req['Accept'] = accept
  req['User-Agent'] = 'utility-flasher'
  req['X-GitHub-Api-Version'] = '2022-11-28'
  token = gh_token
  req['Authorization'] = "Bearer #{token}" if token

  res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 10, read_timeout: 60) do |http|
    http.request(req)
  end

  # Asset downloads redirect to a pre-signed host that rejects our auth header,
  # so follow redirects by hand and drop the header on the hop.
  if res.is_a?(Net::HTTPRedirection) && res['location']
    return gh_get_unauthenticated(res['location'], limit: limit - 1)
  end

  res.is_a?(Net::HTTPSuccess) ? res.body : nil
end

def gh_get_unauthenticated(url, limit: 5)
  return nil if limit.zero?

  uri = URI(url)
  req = Net::HTTP::Get.new(uri)
  req['User-Agent'] = 'utility-flasher'
  res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 10, read_timeout: 60) do |http|
    http.request(req)
  end
  if res.is_a?(Net::HTTPRedirection) && res['location']
    return gh_get_unauthenticated(res['location'], limit: limit - 1)
  end
  res.is_a?(Net::HTTPSuccess) ? res.body : nil
end

def latest_release
  return { error: 'FIRMWARE_TOKEN is unset; cannot read the private firmware repo.' } unless gh_token

  raw = gh_get("https://api.github.com/repos/#{FIRMWARE_REPO}/releases/latest")
  return { error: 'GitHub did not return a latest release.' } unless raw

  data = JSON.parse(raw)
  bin = (data['assets'] || []).find { |a| a['name'] == 'utility.bin' }
  sums = (data['assets'] || []).find { |a| a['name'] == 'utility.bin.sha256' }

  sha = nil
  if sums && (txt = gh_get(sums['url'], accept: 'application/octet-stream'))
    sha = txt.split(/\s+/).first
  end

  {
    tag: data['tag_name'],
    published_at: data['published_at'],
    size: bin && bin['size'],
    asset_url: bin && bin['url'],
    sha256: sha
  }
rescue JSON::ParserError
  { error: 'Malformed response from GitHub.' }
end
