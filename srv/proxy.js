var sys = require("sys"),
	http = require("http"),
	fs = require("fs"),
	url = require("url");

var statics = [
'/css/index.css', 
'/js/ext/jquery.js',
'/js/browser-couch.js'];

http.createServer(function (request, response) {
	if (request.url != "/"){
		sys.puts(request.url);
		if (statics.indexOf(request.url) >=0){
			response.writeHead(200, {"Content-Type": "text/html"});
			var fc = fs.readFileSync("../" + request.url); 
			response.write(fc);
			response.close();
		}
	//Proxy to couch
		else {
			var p = http.createClient(5984, 'localhost');
			var req = p.request(request.method, request.url, request.headers);
			var cont = "", stat, header;
			req.addListener('response', function(resp){
				stat = resp.statusCode;
				header = resp.headers;

				resp.setBodyEncoding("utf8");
				resp.addListener("data", function (chunk) {
					cont +=chunk

				});
				
				resp.addListener('end', function(resp){
					response.writeHead(stat, header);
					response.write(cont);
					response.close();
				});
			});
			req.close();	
		}

	}else{
		response.writeHead(200, {"Content-Type": "text/html"});
		var fc = fs.readFileSync("../serialize.html"); 
		response.write(fc);
		response.close();
	}
	}).listen(8000);
sys.puts("Server running at http://127.0.0.1:8000/");
