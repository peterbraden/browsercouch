/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Ubiquity.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Atul Varma <atul@mozilla.com>
 *   Peter Braden <peterbraden@peterbraden.co.uk>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

// = BrowserCouch =
//
// BrowserCouch is a client side map-reduce data store, inspired by CouchDB. It
// utilizes the browser's local storage where possible, and syncs to a CouchDB
// server.
//

var BrowserCouch = function(opts){
  var bc = {};

  // == Utility Functions ==

  // === {{{isArray()}}} ===
  //
  // A helper function to determine whether an object is an Array or
  // not. Taken from jQuery

  var isArray = function(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
  }

  function keys(obj){
      var ret = []
      for (var key in obj)
          ret.push(key)
      return ret
  }

  var Couch = function Couch(options){
      if (options.url)
          this.baseUrl = options.url
      else{
          this.name = options.name
          this.host = options.host || 'localhost'
          this.port = options.port || 5984
          this.baseUrl = 'http://' + this.host + ':' + this.port + '/' + this.name + '/'
      }
  }
  Couch.prototype = {
      get: function(id, params, callback, context){
          var qs = this.qs(params)
          this.request('GET', id + qs, params, callback, context)
      },
      post: function(id, doc, callback, context){
          this.request('POST', id, JSON.stringify(doc), callback, context)
      },
      put: function(id, doc, callback, context){
          this.request('PUT', id, JSON.stringify(doc), callback, context)
      },
      del: function(doc, callback, context){
          this.request('DELETE', doc._id + '?rev=' + doc._rev, null, callback, context)
      },
      view: function(viewPath, params, callback, context){
          this.get(this.expandViewPath(viewPath, params), callback, context)
      },
      drop: function(callback, context){
          this.request('DELETE', '', null, callback, context)
      },
      create: function(callback, context){
          this.request('PUT', '', null, callback, context)
      },
      qs: function(params){
          if (!params) return ''
              return '?' + keys(params).map(function(key){return key + '=' + encodeURI(params[key])}).join('&')
      },
      expandViewPath: function expandViewPath(viewPath, params){
        var parts = viewPath.split('/')
        var viewPath = '_design/' + parts[0] + '/_view/' + parts[1]
        viewPath += this.qs(params)
        //sys.debug('viewPath: ' + viewPath)
        return viewPath
      },
      request: function request(verb, uri, data, callback, context){
          function _callback(){
              if (this.readyState == 4){
                  var result
                  try{
                      result = JSON.parse(this.responseText)
                  }catch(e){
                      console.log('Parse JSON failed: ' + this.responseText)
                      result = null
                  }

                  callback.call(context, result)
              }else if(this.readyState == 1){
                  this.setRequestHeader('Accept', 'application/json')
              }
          }

          var xhr = new XMLHttpRequest()
          xhr.onreadystatechange = callback ? _callback : null
          var url = this.baseUrl + uri
          //console.log(verb + ': ' + url)
          xhr.open(verb, url, true)
          xhr.send(data)
      }

  }

  window.Couch = Couch

  // === {{{ModuleLoader}}} ===
  //
  // A really basic module loader that allows dependencies to be
  // "lazy-loaded" when their functionality is needed.

  bc.ModuleLoader = {
    LIBS: {JSON: "js/ext/json2.js",
           UUID: "js/ext/uuid.js"},

    require: function ML_require(libs, cb) {
      var self = this,
          i = 0,
          lastLib = "";

      if (!isArray(libs)){
        libs = [libs];
      }

      function loadNextLib() {
        if (lastLib && !window[lastLib]){
          throw new Error("Failed to load library: " + lastLib);
        }
        if (i == libs.length){
          cb();
        }
        else {
          var libName = libs[i];
          i += 1;
          if (window[libName]){
            loadNextLib();
          }
          else {
            var libUrl = self.LIBS[libName];
            if (!libUrl){
              throw new Error("Unknown lib: " + libName);
            }
            lastLib = libName;
            self._loadScript(libUrl, window, loadNextLib);
          }
        }
      }

      loadNextLib();
    },

    _loadScript: function ML__loadScript(url, window, cb) {
      var doc = window.document;
      var script = doc.createElement("script");
      script.setAttribute("src", url);
      script.addEventListener(
        "load",
        function onLoad() {
          script.removeEventListener("load", onLoad, false);
          cb();
        },
        false
      );
      doc.body.appendChild(script);
    }
  };

  // == MapReducer Implementations ==
  //
  // //MapReducer// is a generic interface for any map-reduce
  // implementation. Any object implementing this interface will need
  // to be able to work asynchronously, passing back control to the
  // client at a given interval, so that the client has the ability to
  // pause/cancel or report progress on the calculation if needed.

  // === {{{WebWorkerMapReducer}}} ===
  //
  // A MapReducer that uses
  // [[https://developer.mozilla.org/En/Using_DOM_workers|Web Workers]]
  // for its implementation, allowing the client to take advantage of
  // multiple processor cores and potentially decouple the map-reduce
  // calculation from the user interface.
  //
  // The script run by spawned Web Workers is
  // [[#js/worker-map-reducer.js|worker-map-reducer.js]].

  bc.WebWorkerMapReducer = function WebWorkerMapReducer(numWorkers, Worker) {
    if (!Worker){
      Worker = window.Worker;
    }

    var pool = [];

    function MapWorker(id) {
      var worker = new Worker('js/worker-map-reducer.js');
      var onDone;

      worker.onmessage = function(event) {
        onDone(event.data);
      };

      this.id = id;
      this.map = function MW_map(map, dict, cb) {
        onDone = cb;
        worker.postMessage({map: map.toString(), dict: dict});
      };
    }

    for (var i = 0; i < numWorkers; i++){
      pool.push(new MapWorker(i));
    }

    this.map = function WWMR_map(map, dict, progress, chunkSize, finished) {
      var keys = dict.getKeys();
      var size = keys.length;
      var workersDone = 0;
      var mapDict = {};

      function getNextChunk() {
        if (keys.length) {
          var chunkKeys = keys.slice(0, chunkSize);
          keys = keys.slice(chunkSize);
          var chunk = {};
          for (var i = 0; i < chunkKeys.length; i++){
            chunk[chunkKeys[i]] = dict.get(chunkKeys[i]);
          }
          return chunk;
        } else {
          return null;
        }
      }

      function nextJob(mapWorker) {
        var chunk = getNextChunk();
        if (chunk) {
          mapWorker.map(
            map,
            chunk,
            function jobDone(aMapDict) {
              for (var name in aMapDict){
                if (name in mapDict) {
                  var item = mapDict[name];
                  item.keys = item.keys.concat(aMapDict[name].keys);
                  item.values = item.values.concat(aMapDict[name].values);
                } else{
                  mapDict[name] = aMapDict[name];
                }
              }
              if (keys.length){
                progress("map",
                         (size - keys.length) / size,
                         function() { nextJob(mapWorker); });
              }else{
                workerDone();
              }
            });
        } else{
          workerDone();
        }
      }

      function workerDone() {
        workersDone += 1;
        if (workersDone == numWorkers){
          allWorkersDone();
        }
      }

      function allWorkersDone() {
        var mapKeys = [];
        for (var name in mapDict){
          mapKeys.push(name);
        }
        mapKeys.sort();
        finished({dict: mapDict, keys: mapKeys});
      }

      for (var i = 0; i < numWorkers; i++){
        nextJob(pool[i]);
      }
    };

    // TODO: Actually implement our own reduce() method here instead
    // of delegating to the single-threaded version.
    this.reduce = bc.SingleThreadedMapReducer.reduce;
  };

  // === {{{SingleThreadedMapReducer}}} ===
  //
  // A MapReducer that works on the current thread.

  bc.SingleThreadedMapReducer = {
    map: function STMR_map(map, storage, docPrefix, progress,
                           chunkSize, finished) {
      storage.keys(docPrefix, function(keys){

        var mapDict = {};
        var currDoc;

        function emit(key, value) {
          // TODO: This assumes that the key will always be
          // an indexable value. We may have to hash the value,
          // though, if it's e.g. an Object.
          var item = mapDict[key];
          if (!item){
            item = mapDict[key] = {keys: [], values: []};
          }
          item.keys.push(currDoc._id);
          item.values.push(value);
        }

        var i = 0;

        function continueMap() {
          var iAtStart = i;
          do {
            storage.get(docPrefix + keys[i], function(d){
              currDoc=d;
              map(d, emit)
              });
            i++;
          } while (i - iAtStart < chunkSize &&
                   i < keys.length);

          if (i >= keys.length) {
            var mapKeys = [];
            for (name in mapDict)
              mapKeys.push(name);
            mapKeys.sort();
            finished({dict: mapDict, keys: mapKeys});
          } else
            progress("map", i / keys.length, continueMap);
        }

        continueMap();
      });
    },

    reduce: function STMR_reduce(reduce, mapResult, progress,
                                 chunkSize, finished) {
      var rows = [];
      var mapDict = mapResult.dict;
      var mapKeys = mapResult.keys;

      var i = 0;

      function continueReduce() {
        var iAtStart = i;

        do {
          var key = mapKeys[i];
          var item = mapDict[key];

          var keys = [];
          for (var j = 0; j < keys.length; j++)
            newKeys.push([key, item.keys[j]]);

          rows.push({key: key,
                     value: reduce(keys, item.values)});
          i++;
        } while (i - iAtStart < chunkSize &&
                 i < mapKeys.length)

        if (i == mapKeys.length)
          finished(rows);
        else
          progress("reduce", i / mapKeys.length, continueReduce);
      }

      continueReduce();
    }
  };



    // == View ==
  bc._View = function BC__View(rows) {
    this.rows = rows;

    function findRow(key, rows) {
      if (rows.length > 1) {
        var midpoint = Math.floor(rows.length / 2);
        var row = rows[midpoint];
        if (key < row.key)
          return findRow(key, rows.slice(0, midpoint));
        if (key > row.key)
          return midpoint + findRow(key, rows.slice(midpoint));
        return midpoint;
      } else
        return 0;
    }

    this.findRow = function V_findRow(key) {
      return findRow(key, rows);
    };
  },


  // == MapView ==
  bc._MapView = function BC__MapView(mapResult) {
    var rows = [];
    var keyRows = [];

    var mapKeys = mapResult.keys;
    var mapDict = mapResult.dict;

    for (var i = 0; i < mapKeys.length; i++) {
      var key = mapKeys[i];
      var item = mapDict[key];
      keyRows.push({key: key, pos: rows.length});
      var newRows = [];
      for (var j = 0; j < item.keys.length; j++) {
        var id = item.keys[j];
        var value = item.values[j];
        newRows.push({_id: id,
                      key: key,
                      value: value});
      }
      newRows.sort(function(a, b) {
                     if (a._id < b._id)
                       return -1;
                     if (a._id > b._id)
                       return 1;
                     return 0;
                   });
      rows = rows.concat(newRows);
    }

    function findRow(key, keyRows) {
      if (keyRows.length > 1) {
        var midpoint = Math.floor(keyRows.length / 2);
        var keyRow = keyRows[midpoint];
        if (key < keyRow.key)
          return findRow(key, keyRows.slice(0, midpoint));
        if (key > keyRow.key)
          return findRow(key, keyRows.slice(midpoint));
        return keyRow.pos;
      } else
        return keyRows[0].pos;
    }

    this.rows = rows;
    this.findRow = function MV_findRow(key) {
      return findRow(key, keyRows);
    };
  }




  // == Storage Implementations ==
  //
  // //Storage// is a generic interface for a persistent storage
  // implementation capable of storing JSON-able objects.


  // === {{{FakeStorage}}} ===
  //
  // This Storage implementation isn't actually persistent; it's just
  // a placeholder that can be used for testing purposes, or when no
  // persistent storage mechanisms are available.

  bc.FakeStorage = function FakeStorage() {
    var db = {};

    function deepCopy(obj) {
      if (typeof(obj) == "object") {
        var copy;

        if (isArray(obj))
          copy = new Array();
        else
          copy = new Object();

        for (name in obj) {
          if (obj.hasOwnProperty(name)) {
            var property = obj[name];
            if (typeof(property) == "object")
              copy[name] = deepCopy(property);
            else
              copy[name] = property;
          }
        }

        return copy;
      } else
        return obj;
    }

    this.get = function FS_get(name, cb) {
      if (!(name in db))
        cb(null);
      else
        cb(db[name]);
    };

    this.put = function FS_put(name, obj, cb) {
      db[name] = deepCopy(obj);
      cb();
    };

    this.remove = function(name, cb){
      delete db[name];
      if(cb){cb();}
    }

    this.keys = function(prefix, cb){
      var out = [];
      for (var i in db){
        if (i.slice(0, prefix.length)===prefix){
          out.push(i);
        }
      }
      cb(out);
    }

  };

  // === {{{LocalStorage}}} ===
  //
  // This Storage implementation uses the browser's HTML5 support for
  // {{{localStorage}}} or {{{globalStorage}}} for object persistence.
  //
  // Each database is stored in a key, as a JSON encoded string. In
  // future we may want to rethink this as it's horribly innefficient

  bc.LocalStorage = function LocalStorage() {
    var storage;

    if (window.localStorage)
      storage = window.localStorage;
    else if (window.globalStorage)
      storage = window.globalStorage[location.hostname];
    else {
        throw new Error("globalStorage/localStorage not available.");
    }


    this.get = function LS_get(name, cb) {
      if (name in storage && storage[name])//.value)
        bc.ModuleLoader.require('JSON',
          function() {
            var obj = JSON.parse(storage[name])//.value);
            cb(obj);
          });
      else
        cb(null);
    };

    this.put = function LS_put(name, obj, cb) {
      bc.ModuleLoader.require('JSON',
        function() {
          storage[name] = JSON.stringify(obj);
          if (cb) cb();
        });
    };

    this.remove = function(name, cb){
      delete storage[name];
      if(cb){cb();}

    }

    this.keys = function(prefix, cb){
      var out = [];
      for (var i = 0; i < storage.length; i++){
        var key = storage.key(i);
        if (key.slice(0, prefix.length)===prefix){
          out.push(key.slice(prefix.length, key.length));
        }
      }
      cb(out);
    }

  }

  bc.LocalStorage.isAvailable = (this.location &&
                              this.location.protocol != "file:" &&
                              (this.globalStorage || this.localStorage));


  // == Database Wrapper Interface ==
  //
  // A basic database interface. Implementing objects
  // should support methods that emulate the basic REST commands
  // that CouchDB uses.
  //

  // === Local Storage Database ===
  // TODO, rename this
  bc.BrowserDatabase = function(name, storage, cb, options) {
    var self = {},
        dbName = 'BC_DB_' + name,
        seqPrefix = dbName + '__seq_',
        docPrefix = dbName + '_doc_',
        _lastSeq,
        _docCount;
    self.name = name;

    var seqs = function(cb){
      storage.keys(seqPrefix, cb);
    }

    var removeBySeq = function(seq){
      storage.get(seqPrefix + seq, function(seqInfo){
        var docId = seqInfo.id
        storage.remove(docPrefix + docId);
        storage.remove(seqPrefix + seq);
      });
    }

    self.wipe = function DB_wipe(cb) {
      seqs(function(sqs){
        for (var seq in sqs){
          removeBySeq(sqs[seq]);
        }
        cb();
      });
    };

    self.get = function DB_get(id, cb, options) {
      cb = cb || function(){}
      storage.get(docPrefix + id, function(doc){
        if (doc && !doc._deleted)
          cb(doc)
        else
          cb(null)
      });
    };

    // === {{{PUT}}} ===
    //
    // This method is vaguely isomorphic to a
    // [[http://wiki.apache.org/couchdb/HTTP_Document_API#PUT|HTTP PUT]] to a
    // url with the specified {{{id}}}.
    //
    // It creates or updates a document
    self.put = function DB_put(document, cb, options) {
      options = options || {};
      var newEdits = 'new_edits' in options ? options.new_edits: true;

      var self = this;
      var putObj = function(obj){
        storage.get(docPrefix + obj._id, function(orig){
          if (newEdits && orig && orig._rev != obj._rev){
            console.log('original: ' + JSON.stringify(orig));
            console.log('new: ' + JSON.stringify(obj));
            throw new Error('Document update conflict.');
          }else{
            function newHash(){
              return (Math.random()*Math.pow(10,20));
            }
            //= Update Rev =
            if (!obj._rev){
              // We're using the naive random versioning, rather
              // than the md5 deterministic hash.
              obj._rev = "1-" + newHash();
            }else{
              function revIndex(doc){
                return parseInt(doc._rev.split('-')[0])
              }
              function revHash(doc){
                return doc._rev.split('-')[1]
              }

              if (newEdits){
                obj._rev = (revIndex(obj)+1) + '-' + newHash();
              }else if (orig && obj._rev != orig._rev){
                var winner;
                // use deterministic winner picking algorithm
                if (revIndex(obj) > revIndex(orig))
                  winner = obj
                else if (revIndex(orig) > revIndex(obj))
                  winner = orig
                else if (revHash(obj) > revHash(orig))
                  winner = obj
                else
                  winner = orig

                var loser = obj === winner ? orig : obj;
                obj = winner

                if (!obj._conflicts)
                  obj._conflicts = []
                obj._conflicts.push(loser._rev)
              }
            }
            if (!orig)
              _docCount = self.docCount() + 1;
            if (obj._deleted){
              obj._revWhenDeleted = orig._rev;
              _docCount = self.docCount() - 1;
            }
            var seq = self.lastSeq() + 1;
            _lastSeq = seq;
            storage.put(docPrefix + obj._id, obj, function(){});
            storage.put(seqPrefix + seq, obj._id, function(){})
          }
        })

      }

      if (isArray(document)) {
        for (var i = 0; i < document.length; i++){
          putObj(document[i]);
        }
      } else{
        putObj(document);
      }
      if (cb)
        cb();
    };



    // === {{{POST}}} ===
    //
    // Roughly isomorphic to the two POST options
    // available in the REST interface. If an ID is present,
    // then the functionality is the same as a PUT operation,
    // however if there is no ID, then one will be created.
    //
    self.post =function(data, cb, options){
      var _t = this
      if (!data._id)
        bc.ModuleLoader.require('UUID', function(){
          data._id = new UUID().createUUID();
          _t.put(data, function(){cb(data._id)}, options);
        });
      else{
        _t.put(data, function(){cb(data._id)}, options)
      }
    }

    // === {{{DELETE}}} ===
    //
    // Delete the document.
    self.del = function(doc, cb){
      this.put({_id : doc._id, _rev : doc._rev, _deleted : true}, cb);
    }

    //
    self.docCount = function DB_docCount() {
      if (_docCount !== undefined) return _docCount;
      _docCount = 0;
      var self = this;
      var ids = [];
      var seq = 1;
      var stop = false;
      while (!stop){
        storage.get(seqPrefix + seq, function(id){
          if (!id){
            stop = true;
            _docCount = ids.length;
          }else{
            self.get(id, function(doc){
              if (doc && ids.indexOf(id) == -1)
                ids.push(id)
            })
          }
        })
        seq++
      }
      return _docCount;
    };

    self.lastSeq = function BC_lastSeq(){
      if (_lastSeq !== undefined) return _lastSeq
      var seq = 1;
      var stop = false;
      while (!stop){
        storage.get(seqPrefix + seq, function(id){
          if (!id){
            stop = true;
            _lastSeq = seq - 1;
          }
        })
        seq++
      }
      return _lastSeq;
    }

    // === View ===
    //
    // Perform a query on the data. Queries are in the form of
    // map-reduce functions.
    //
    // takes object of options:
    //
    // * {{{options.map}}} : The map function to be applied to each document
    //                       (REQUIRED)
    //
    // * {{{options.finished}}} : A callback for the result.
    //                           (REQUIRED)
    //
    // * {{{options.chunkSize}}}
    // * {{{options.progress}}} : A callback to indicate progress of a query
    // * {{{options.mapReducer}}} : A Map-Reduce engine, by default uses a
    //                              single thread
    // * {{{options.reduce}}} : The reduce function

    self.view = function DB_view(options) {
      if (!options.map)
        throw new Error('map function not provided');
      if (!options.finished)
        throw new Error('finished callback not provided');

      // Maximum number of items to process before giving the UI a chance
      // to breathe.
      var DEFAULT_CHUNK_SIZE = 1000;

      // If no progress callback is given, we'll automatically give the
      // UI a chance to breathe for this many milliseconds before continuing
      // processing.
      var DEFAULT_UI_BREATHE_TIME = 50;

      var chunkSize = options.chunkSize;
      if (!chunkSize)
        chunkSize = DEFAULT_CHUNK_SIZE;

      var progress = options.progress;
      if (!progress)
        progress = function defaultProgress(phase, percent, resume) {
          window.setTimeout(resume, DEFAULT_UI_BREATHE_TIME);
        };

      var mapReducer = options.mapReducer;
      if (!mapReducer)
        mapReducer = bc.SingleThreadedMapReducer;

      mapReducer.map(
        options.map,
        storage,
        docPrefix,
        progress,
        chunkSize,
        function(mapResult) {
          if (options.reduce)
            mapReducer.reduce(
              options.reduce,
              mapResult,
              progress,
              chunkSize,
              function(rows) {
                options.finished(new BrowserCouch._View(rows));
              });
          else
            options.finished(new BrowserCouch._MapView(mapResult));
        });
    };

    self.getChanges = function(cb, since){
      since = since || 0;
      var changes = [];
      var curSeq = since + 1;
      var lastSeq;
      var stop = false;
      while(!stop){
        storage.get(seqPrefix + curSeq, function(docId){
          if (!docId){
            stop = true;
            lastSeq = curSeq - 1;
          }else
            storage.get(docPrefix + docId, function(doc){
              if (!doc){
                throw new Error('Doc not found: ' + curSeq + ', ' + docId)
              }
              var change = {seq: curSeq, id: docId, changes: [{rev: doc._rev}]};
              if (doc._deleted)
                change.deleted = doc._deleted;
              changes.push(change);
            })
        })
        curSeq++;
      }
      // remove dups
      var docIds = {}; // simulate a set
      var _changes = [];
      for (var i = changes.length - 1; i >= 0; i--){
        var change = changes[i];
        if (change.id in docIds) continue;
        docIds[change.id] = true
        _changes.push(change);
      }

      cb({
        results: _changes,
        last_seq: lastSeq
      });
    }

    self.createBulkDocs = function BC_createBulkDocs(changes){
      var docs;
      var ret = {
        new_edits: false,
        docs: docs = []
      }
      for (var i = 0; i< changes.results.length; i++){
        var res = changes.results[i];
        var id = res.id;
        var rev = res.changes[0].rev
        var revParts = rev.split('-')
        var doc;
        if (!res.deleted){
          self.get(id, function(d){
            doc = d
            doc._revisions = {
              start: parseInt(revParts[0]),
              ids: [revParts[1]]
            }
          });
        }else{
          var revWhenDeleted;
          storage.get(seqPrefix + res.seq, function(docId){
            storage.get(docPrefix + docId, function(ddoc){
              revWhenDeleted = ddoc._revWhenDeleted;
            })
          })
          doc = {
            _id: id,
            _rev: rev,
            _deleted: true
          }
          doc._revisions = {
            start: parseInt(revParts[0]),
            ids: [revParts[1], revWhenDeleted.split('-')[1]]
          }
        }
        docs.push(doc);
      }
      return ret
    }

    function getRepInfo(source, target){
      var dbInfo;
      storage.get(dbName, function(di){
        dbInfo = di;
      })
      if (!dbInfo || !dbInfo.replications) return 0;
      return dbInfo.replications[source + ',' + target] || 0;
    }
    function setRepInfo(source, target, since){
      var dbInfo;
      storage.get(dbName, function(di){
        dbInfo = di;
      })
      if (!dbInfo)
        dbInfo = {}
      if (!dbInfo.replications)
        dbInfo.replications = {};
      dbInfo.replications[source + ',' + target] = since;
      storage.put(dbName, dbInfo, function(){})
    }

    self.syncToRemote = function BC_syncTo(target, cb){
      var source = 'BrowserCouch:' + dbName
      var since = getRepInfo(source, target);
      var couch = new Couch({url: target});
      var self = this;
      this.getChanges(function(changes){
        var bulkDocs = self.createBulkDocs(changes);
        //console.log('bulkDocs: ' + JSON.stringify(bulkDocs));
        couch.post('_bulk_docs', bulkDocs, function(reply){
          couch.post('_ensure_full_commit', 'true', function(reply){
            setRepInfo(source, target, changes.last_seq)
            if (cb) cb(reply)
          }, this)
        }, this)
      }, since);
    }

    self.syncFromRemote = function BC_syncFrom(source, cb){
      var self = this;
      var target = 'BrowserCouch:' + dbName;
      var since = getRepInfo(source, target);
      var couch = new Couch({url: source});
      couch.get('_changes', {include_docs: true, since: since}, function(changes){
        var results = changes.results;
        for (var i = 0; i < results.length; i++){
          var res = results[i];
          self.put(res.doc, function(){}, {new_edits: false});
        }
        setRepInfo(source, target, changes.last_seq)
        if (cb) cb()
      })
    }

    self.syncToLocal = function BC_syncToLocal(target, cb){
      var self = this;
      var targetDb;
      if (typeof(target) == 'string'){
        targetDb = BrowserCouch(target);
        target = 'BrowserCouch:' + target;
      }else{
        targetDb = target;
        target = 'BrowserCouch:' + target.name;
      }
      var source = 'BrowserCouch:' + dbName;
      var since = getRepInfo(source, target);
      this.getChanges(function(changes){
        var results = changes.results;
        for (var i = 0; i < results.length; i++){
          var res = results[i];
          if (res.deleted){
            storage.get(docPrefix + res.id, function(ddoc){
              targetDb.put(ddoc, function(){}, {new_edits: false});
            })
          }else
            self.get(res.id, function(doc){
              targetDb.put(doc, function(){}, {new_edits: false});
            })
        }
        setRepInfo(source, target, changes.last_seq)
        if (cb) cb({ok: true})
      }, since);
    }


    // ==== Sync the database ====
    // Emulates the CouchDB replication functionality
    // At the moment only couch's on the same domain
    // will work beause of XSS restrictions.
    self.syncTo = function BC_syncTo(target, cb){
      var self = this
      var parts = target.split(":");
      var proto = parts[0];
      if (proto == 'BrowserCouch')
        self.syncToLocal(parts[1], cb)
      else if (proto == 'http')
        self.syncToRemote(target, cb)
      else
        throw new Error('Invalid protocol: ' + target);
    }

    self.syncFrom = function BC_syncFrom(source, cb){
      var self = this
      var parts = source.split(":");
      var proto = parts[0];

      if (proto == 'BrowserCouch'){
        var sourceDb = BrowserCouch(parts[1]);
        sourceDb.syncToLocal(self, cb)
      }else if (proto == 'http')
        self.syncFromRemote(source, cb)
      else
        throw new Error('Invalid protocol: ' + source);
    },

    cb(self)

  }




  // === //List All Databases// ===
  //
  // Similar to {{{/_all_dbs}}} as there is no way to see what
  // keys are stored in localStorage, we have to store a metadata
  // database
  //
  bc.allDbs = function(cb){
    //TODO
  }

  // == {{{BrowserCouch}}} Core Constructor ==
  //
  // {{{BrowserCouch}}} is the main object that clients will use.  It's
  // intended to be somewhat analogous to CouchDB's RESTful API.
  //
  // Returns a wrapper to the database that emulates the HTTP methods
  // available to /<database>/
  //
  var cons = function(name, options){
    var options = options || {};

    var self = {
      // 'private' variables - perhaps we should move these into the closure
      loaded : false,
      loadcbs : [],


      // ==== Add an onload function ====
      // Seeing as we're completely callback driven, and you're
      // frequently going to want to do a bunch of things once
      // the database is loaded, being able to add an arbitrary
      // number of onload functions is useful.
      //
      // Onload functions are called with no arguments, but the
      // database object from the constructor is now ready.
      // (TODO - change this?)
      //
      onload : function(func){
        if (self.loaded){
          func(self);
        } else{
          self.loadcbs.push(func);
        }
      }



    };
    // Create a database wrapper.
    bc.BrowserDatabase(name,
      options.storage || new bc.LocalStorage(), // TODO - check local storage is available
      function(db){
        // == TODO ==
        // We're copying the resultant methods back onto
        // the self object. Could do this better.
        for (var k in db){
          self[k] = db[k];
        }

        // Fire the onload callbacks
        self.loaded = true;
        for (var cbi in self.loadcbs){
            self.loadcbs[cbi](self);
          }
      }, options.storage, options);

      return self;
  }

  // == TODO ==
  // We're copying the bc methods onto the Database object.
  // Need to do this better, should research the jquery object.
  for (var k in bc){
    cons[k] = bc[k];
  }
  return cons
}();
