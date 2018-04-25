// FramebufferTexture represents a texture into which we can write smaller texture tiles

function FramebufferTexture( width, height, options ) {
  THREE.WebGLRenderTarget.call( this, width, height, options );

  this.loading = true;
  this.scale = 1;
}
FramebufferTexture.prototype = Object.create(THREE.WebGLRenderTarget.prototype); 
Object.assign(FramebufferTexture.prototype, {
  //FramebufferTexture.prototype.constructor = FramebufferTexture;

  setScale: function(scale) {
    this.scale = scale || 1;
  },
  finalize: function() {
    // TODO - perform any postprocessing or clean-up here
    console.log('done');
  }
});

function FramebufferTextureLoader( manager ) {

	this.manager = ( manager !== undefined ) ? manager : THREE.DefaultLoadingManager;

  this.tilequeue = [];

  this.renderer = false;
  this.orthocam = new THREE.OrthographicCamera(0, 1, 1, 0, -100, 100);
  this.background = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({color: 0xff0000, side: THREE.DoubleSide}));
  this.tile = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide, map: new THREE.Texture()}));
  this.scene = new THREE.Scene();

  this.scene.add(this.background);
  this.scene.add(this.orthocam);
  this.scene.add(this.tile);

}

Object.assign( FramebufferTextureLoader.prototype, {
  tilesize: 512,

	load: function ( url, onLoad, onProgress, onError ) {
    var texture = new FramebufferTexture(1, 1, {});
    this.clear(texture, 0xff0000);
    var tilesize = this.tilesize;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function(ev) {
      var data = xhr.response;
console.log('got data', xhr);
      this.parseWithWorker(texture, data, xhr.getResponseHeader('Content-Type'), tilesize);
    }.bind(this);
    xhr.send(null);

    return texture;
  },
  parseWithWorker: function(texture, data, type, tilesize) {
    var parser = function(data, tilesize) {
      var generateThings = function*() {
        for (var x = 0; x < state.tilecols; x++) {
          for (var y = 0; y < state.tilerows; y++) {
            yield {x: x, y: y, tilesize: tilesize, img: state.img};
          }
        }
      };
      var processThing = function(thing) {
console.log('process the thing', thing);
        if (!thing || thing.done) return;
        var x = thing.value.x,
            y = thing.value.y,
            tilesize = thing.value.tilesize,
            img = thing.value.img;

        createImageBitmap(img, x * tilesize, y * tilesize, tilesize, tilesize)
          .then(function(imagedata) {
            postMessage({type: 'progress', data: {x: x * tilesize, y: y * tilesize, tilesize: tilesize, image: imagedata}}, [imagedata]);
          });
      };

      //console.log('parser begins', data, tilesize);
      // TODO - handle non-PoT textures too!

      if (data.type == "begin") {
        var blob = new Blob([data.bytes], {type: data.contenttype});
        var maxsize = data.maxsize || Infinity;

        createImageBitmap(blob).then(function(imgdata) {
          var img = state.img = imgdata;
          var width = Math.min(img.width, maxsize),
              height = Math.min(img.height, maxsize),
              aspect = img.width / img.height;
          if (img.width > img.height) {
            width = Math.min(img.width, maxsize);
            scale = width / img.width;
            height = width / aspect;
          } else {
            height = Math.min(img.height, maxsize);
            scale = height / img.height;
            width = height * aspect;
          }
console.log('do it', [img.width, img.height], [width, height], aspect, scale);
          state.tilecols = img.width / tilesize;
          state.tilerows = img.height / tilesize;
          state.total = state.tilecols * state.tilerows;
          state.processed = 0;
          state.processing = 0;
          postMessage({type: 'start', size: [width, height], scale: scale});

          /*
          createImageBitmap(img, 0, 0, img.width, img.height, {resizeWidth: tilesize, resizeHeight: tilesize})
            .then(function(imagedata) {
              postMessage({type: 'progress', data: {x: 0, y: 0, tilesize: tilesize, image: imagedata, scale: img.width / tilesize}}, [imagedata]);
            });
          */

          state.it = generateThings();
console.log('iterate', state.processing, state.processed, state.total);
          while (++state.processing < 5 && state.processed + state.processing < state.total) {
            processThing(state.it.next());
          }
        }).catch(function(e) {
          console.log('error!', e);
        });
      } else if (data.type == 'ack') {
console.log('got acks', state);
        state.processed++;
        state.processing--;
        if (state.it) {
console.log('do the next guy', state.processing, state.processed, state.total);
console.log('boing');
          do {
            processThing(state.it.next());
          } while (++state.processing < 5 && state.processed + state.processing < state.total);
        } else {
console.log('done?');
          img.close();
          postMessage({type: 'finish'});
        }
      }
    };

    var workercode = 'var state = {}, parser = ' + parser.toString() + ';\nonmessage = function ( e ) { parser( e.data, ' + tilesize + ' ); }';
    var blob = new Blob( [ workercode ], { type: 'text/plain' } );
    var worker = new Worker( window.URL.createObjectURL( blob ) );
    worker.addEventListener( 'message', function ( e ) {
      var msg = e.data;
      if (msg.type == 'start') {
        //console.log('image resize', msg.data);
        texture.setSize(msg.size[0], msg.size[1]);
        texture.setScale(msg.scale);
        this.clear(texture, 0x0000ff);
      } else if (msg.type == 'progress') {
        //console.log('got a tile!', msg);
        //texture.blit(msg.data.x, msg.data.y, msg.data.image);
        this.addToTileQueue({target: texture, tile: msg.data, worker: worker});

      } else if (msg.type == 'finish') {
        texture.finalize();
        worker.terminate();
      }
    }.bind(this) );
    worker.postMessage({type: 'begin', contenttype: type, bytes: data, tilesize: tilesize, maxsize: this.maxsize }, [data]);
  },
  setRenderer: function( renderer ) {
    this.renderer = renderer;
    this.maxsize = renderer.capabilities.maxTextureSize;
  },
  setSize: function( width, height ) {
    this.orthocam.left = 0;
    this.orthocam.right = width;
    this.orthocam.top = height;
    this.orthocam.bottom = 0;
    this.orthocam.near = -100;
    this.orthocam.far = 100;

    this.orthocam.updateProjectionMatrix();

    this.background.scale.set(width, height, 1);
    this.background.position.set(width/2,height/2,0);

  },
  render: function(target) {
	  var oldAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    //console.log(target.width, target.height, this.tile.visible, this.tile.position.toArray());
    this.setSize(target.width, target.height);
    this.renderer.render(this.scene, this.orthocam, target);
    this.renderer.autoClear = oldAutoClear;
  },
  clear: function( target, color ) {
    this.background.visible = true;
    this.background.material.color.set(color);
    this.render(target);
    this.background.visible = false;
  },
  blit: function( target, x, y, src ) {
    var texture = (this.texture ? this.texture : new THREE.Texture());
    this.texture = texture;
    texture.image = src;
    //console.log('blit it!', x, y, src, target, texture, target.scale);
    texture.needsUpdate = true;
    this.tile.material.map = texture;
    this.tile.scale.set(src.width * target.scale, -src.height * target.scale, 1);
    this.tile.position.set((x + src.width/2) * target.scale, target.height - ((y + src.height/2) * target.scale), 1);
    this.tile.visible = true;
    this.render(target);
    this.tile.visible = false;
    //texture.image = null;
    //texture.dispose();
  },
  addToTileQueue: function(job) {
    this.tilequeue.push(job);

    if (!this.processing) this.processTileQueueStart();
  },
  processTileQueueStart: function() {
    this.processing = true
    requestIdleCallback(this.processTileQueue.bind(this));
  },
  processTileQueue: function(idletimer) {
    var processed = 0, attempt = 0;
    while (idletimer.timeRemaining() > 0 && this.tilequeue.length > 0) {
        var job = this.tilequeue.pop();
        this.processTileJob(job);
        processed++;
    }
//console.log('processed ' + processed + ' items, ' + attempt + ' attempts, ' + this.tilequeue.length + ' remain, ', idletimer.timeRemaining());
//console.log('do the next guy?', this.tilequeue.length);
    if (this.tilequeue.length > 0) {
      this.processTileQueueStart();
    } else {
      this.processing = false;
    }
  },
  processTileJob: function(job) {
console.log('jobby', job);
    var target = job.target,
        tile = job.tile,
        worker = job.worker;
    this.blit(target, tile.x, tile.y, tile.image);
    
    worker.postMessage({type: 'ack', x: tile.x, y: tile.y});
    tile.image.close();
  }

/*
        requestIdleCallback(function(idletimer) {
          while (idletimer.timeRemaining() > 0) {
            worker.postMessage({type: 'ack', x: msg.data.x, y: msg.data.y});
          }
        });
  }
*/
});

