require 'sinatra'

get '/' do
 File.read('public/index.html')
end

get '/resume' do
 File.read('msc/christian_resume.pdf')
end
