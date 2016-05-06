require 'sinatra'

get '/' do
 File.read('public/index.html')
end

get '/resume/' do
 File.read('public/msc/christian_resume.pdf')
end
