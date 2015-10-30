/* JSONPathAsync 0.9.0 - XPath for JSON And REST (Async)
 *
 * Copyright (c) 2007 Stefan Goessner (goessner.net)
 * Async capabilities added by James Wright (2015)
 * Licensed under the MIT (MIT-LICENSE.txt) licence.
 */

function jsonPathAsync(obj, expr, arg) {
   var d = $j.Deferred();
   var P = {
	  processApiResponse: function(resource, previous) {
		   var value = resource;
	       if(resource && resource.list) {
	      	 value = previous ? resource.list.concat(previous) : resource.list;
	      	 if(resource.links && resource.links.next) {
	      		return $j.when(request(resource.links.next), value)
	      					.then(P.processApiResponse);
	      	 }
	       }   
	       
	       return value;
      },
      resultType: arg && arg.resultType || "VALUE",
      result: [],
      normalize: function(expr) {
         var subx = [];
         return expr.replace(/[\['](\??\(.*?\))[\]']/g, function($0,$1){return "[#"+(subx.push($1)-1)+"]";})
                    .replace(/'?\.'?|\['?/g, ";")
                    .replace(/;;;|;;/g, ";..;")
                    .replace(/;$|'?\]|'$/g, "")
                    .replace(/#([0-9]+)/g, function($0,$1){return subx[$1];});
      },
      asPath: function(path) {
         var x = path.split(";"), p = "$";
         for (var i=1,n=x.length; i<n; i++)
            p += /^[0-9*]+$/.test(x[i]) ? ("["+x[i]+"]") : ("['"+x[i]+"']");
         return p;
      },
      store: function(p, v) {
         if (p) P.result[P.result.length] = P.resultType == "PATH" ? P.asPath(p) : v;
         return !!p;
      },
      trace: function(expr, valIn, path) {
          // BEGIN knockout.js edit
    	  var val = ko.unwrap(valIn);
    	  var promise = val;
    	  if(val && (val._title && !val._hydrated) && val.resources && val.resources.self) {
    		  promise = jsonPath.oracle.getEntity(val.resources.self.ref);
    	  }
    	  
    	  return $j.when(expr, promise).then(function(expr, val) {
	    	  if (expr) {
	            var x = expr.split(";"), loc = x.shift();
	            x = x.join(";");
	            
	            if (val && val.hasOwnProperty(loc)) {
	               var v = ko.unwrap(val[loc]);
	               if(v === undefined || v === null || v.length === 0) {
	            	   if(val.resources && val.resources[loc]) {
	            		   v = jsonPath.oracle.hydratePaths(val, loc);
	            	   }
	               }	                 
	               
	               return $j.when(v).then(function () { return P.trace(x, val[loc], path + ";" + loc); });
	            }
	            else if (val && (val.list)) {
	               if(val.links && val.links.next) {
	            	   return request(val.links.next)
	            	   		.then(P.processApiResponse)
	            	   		.then(function(res) { return P.trace(loc, res, path); });
	               }
	               
	               return P.trace(expr, val.list, path);
	            }
	            else if (val && val.resources && val.resources[loc]) {        
	               return request(val.resources[loc].ref)
	                    .then(P.processApiResponse)
	               		.then(function(res) {return P.trace(x, res, path + ";" + loc); });
	            }
	            else if (loc === "*")
	               return P.walk(loc, x, val, path, function(m,l,x,v,p) { return P.trace(m+";"+x,v,p); });
	            else if (loc === "..") {
	               return $j.when(P.trace(x, val, path),
	                       P.walk(loc, x, val, path, function(m,l,x,v,p) { typeof v[m] === "object" && P.trace("..;"+x,v[m],p+";"+m); }));
	            }
	            else if (/,/.test(loc)) { // [name1,name2,...]
	               var promises = [];
	               for (var s=loc.split(/'?,'?/),i=0,n=s.length; i<n; i++) {
	                  promises.push(P.trace(s[i]+";"+x, val, path));
	               }
	               return $j.when.apply($j, promises);
	            }
	            else if (/^\(.*?\)$/.test(loc)) // [(expr)]
	               return P.trace(P.eval(loc, val, path.substr(path.lastIndexOf(";")+1))+";"+x, val, path);
	            else if (/^\?\(.*?\)$/.test(loc)) // [?(expr)]
	               return P.walk(loc, x, val, path, function(m,l,x,v,p) { 
			            	   return P.eval(l.replace(/^\?\((.*?)\)$/,"$1"),v[m],m).then(function (result) {
			            		   if(result) { 
			            			   return P.trace(m+";"+x,v,p); 
			            		   } else {
			            			   return;
			            		   }
			            	   }); 
	            	      }
	               );
	            else if (/^(-?[0-9]*):(-?[0-9]*):?([0-9]*)$/.test(loc)) // [start:end:step]  phyton slice syntax
	               return P.slice(loc, x, val, path);
	         }
	         else
	            P.store(path, val);
    	  });
    	// END knockout.js edit
      },
      walk: function(loc, expr, val, path, f) {
    	 var promises = [];
         if (val instanceof Array) {
            for (var i=0,n=val.length; i<n; i++)
               if (i in val)
                  promises.push(f(i,loc,expr,val,path));
         }
         else if (typeof val === "object") {
            for (var m in val)
               if (val.hasOwnProperty(m))
                  promises.push(f(m,loc,expr,val,path));
         }
         return $j.when.apply($j, promises);
      },
      slice: function(loc, expr, val, path) {
    	 var promises = [];
         if (val instanceof Array) {
            var len=val.length, start=0, end=len, step=1;
            loc.replace(/^(-?[0-9]*):(-?[0-9]*):?(-?[0-9]*)$/g, function($0,$1,$2,$3){start=parseInt($1||start);end=parseInt($2||end);step=parseInt($3||step);});
            start = (start < 0) ? Math.max(0,start+len) : Math.min(len,start);
            end   = (end < 0)   ? Math.max(0,end+len)   : Math.min(len,end);
            for (var i=start; i<end; i+=step)
               promises.push(P.trace(i+";"+expr, val, path));
         }
         
         return $j.when.apply($j, promises);
      },
      eval: function(x, _v, _vname) {         
        if($ && _v) {
        	var p = [];
        	var exp = x.replace(/@/g, "_v");
        	var expGrp = exp.split(/\s+[&]{2}\s+/g);
            for(var g = 0; g < expGrp.length; g++) {
	        	var exps = expGrp[g].split(/\s+/g);
	       		var evalCtx = { $: $, _v: _v};
	       		var gP = [];
	       		for(var e = 0; e < exps.length; e++) {
	       			var value = exps[e];
	       			if(value && $j.type(value) === 'string' && value.match(/.*\{\{.*?\}\}.*|^\$[.\[]|^_v[.\[]/g)) {
	       				gP.push(jsonPathAsync(evalCtx, '$.' + exps[e]));
	       			} else {
	       				gP.push(value);
	       			}
	       		}
	       		p.push($j.when.apply($j, gP).then(function() { 			
	       			try {
	       				var result = arguments[0];
	       				if(arguments.length > 1) {
	       					result = jsonPath.oracle.equate(arguments[0], arguments[2], arguments[1] || '!=');
	       				}
	       				return result;
	       			} catch(e) { 
	       				throw new SyntaxError("jsonPath: " + e.message + ": " + x.replace(/@/g, "_v").replace(/\^/g, "_a")); 
	       			}
	       		}));
            }
        		
       		return $j.when.apply($j, p).then(function () {
       			var args = arguments;
       			for(var i = 0; i < arguments.length; i++) {
       				if(!arguments[i]) {	return false; }
       			}
       			return true;
       		});
       	} else {
       		return $j.when(false);
       	}              
      }
   };

   var $ = obj;
   if (expr && obj && (P.resultType == "VALUE" || P.resultType == "PATH")) {
      P.trace(P.normalize(expr).replace(/^\$;/,""), obj, "$").done(function () {
          P.result.length ? d.resolve(P.result) : d.resolve(undefined);
      }).fail(function () {
    	  d.resolve(undefined);
      });
   }
   return d.promise();
} 
