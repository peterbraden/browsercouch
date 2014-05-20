describe('BrowserCouch Replicate down', {async: true})
  .before(function(){
    this.couch = new Couch({name: 'down'})
    localStorage.clear()
    this.db = BrowserCouch("rep", {storage: new BrowserCouch.LocalStorage()});
    this.couch.drop(function(){
        this.couch.create(function(){
            this.couch.put('1', {name: 'Emma'}, function(){
                this.finish()
            }, this)
        }, this)
    }, this)
  })
  .should('replicate create', function(){
    var self = this
    this.db.syncFromRemote(this.couch.baseUrl, function(){
      self.db.get('1', function(emma){
        self.expect(emma.name).toBe('Emma')
        self.finish()
      })
    }, this)
  })
  .should('replicate edit', function(){
    var self = this
    self.db.syncFromRemote(this.couch.baseUrl, function(){
      self.couch.get('1', null, function(doc){
        doc.name = 'Emily'
        self.couch.put(doc._id, doc, function(){
          self.db.syncFromRemote(self.couch.baseUrl, function(){
            self.db.get('1', function(emily){
              self.expect(emily.name).toBe('Emily')
              self.finish()
            })
          })
        })
      })
    })
  })
  .should('replicate delete', function(){
    var self = this
    self.db.syncFromRemote(self.couch.baseUrl, function(){
      self.couch.get('1', null, function(doc){
        doc.name = 'Emily'
        self.couch.del(doc, function(){
          self.db.syncFromRemote(self.couch.baseUrl, function(){
            self.db.get('1', function(doc){
              self.expect(doc).toBe(null)
              self.expect(self.db.docCount()).toBe(0)
              self.finish()
            })
          })
        })
      })
    })
  })
  .should('replicate multiple changes', function(){
    var self = this
    self.db.syncFromRemote(self.couch.baseUrl, function(){
      self.couch.get('1', null, function(doc){
        doc.name = 'Emily'
        var alan = {_id: '2', name: 'Alan'}
        self.couch.put(alan._id, alan, function(){
          self.couch.del(doc, function(){
            self.db.syncFromRemote(self.couch.baseUrl, function(){
              self.db.get('1', function(doc){
                self.expect(doc).toBe(null)
                self.expect(self.db.docCount()).toBe(1)
                self.db.get('2', function(alan){
                  self.expect(alan.name).toBe('Alan')
                  self.finish()
                })
              })
            })
          })
        })
      })
    })
  })
