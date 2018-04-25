function FramebufferTexture( width, height, options ) {
  THREE.WebGLRenderTarget.call( this, width, height, options );

  this.renderer = false;
  this.orthocam = new THREE.OrthographicCamera(0, width, height, 0, -100, 100);
  this.background = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({color: 0xff0000, side: THREE.DoubleSide}));
  this.tile = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide, map: new THREE.Texture()}));
  this.scene = new THREE.Scene();

  this.scene.add(this.background);
  this.scene.add(this.orthocam);
  this.scene.add(this.tile);

  this.background.scale.set(width, height, 1);
  this.background.position.set(width/2,height/2,0);

}
FramebufferTexture.prototype = Object.create(THREE.WebGLRenderTarget.prototype); 
Object.assign(FramebufferTexture.prototype, {
  //FramebufferTexture.prototype.constructor = FramebufferTexture;

  setRenderer: function( renderer ) {
    this.renderer = renderer;
    this.clear(0x990000);
  },
  setSize: function( width, height ) {
    THREE.WebGLRenderTarget.prototype.setSize.call(this, width, height);

    this.orthocam.left = 0;
    this.orthocam.right = width;
    this.orthocam.top = height;
    this.orthocam.bottom = 0;
    this.orthocam.near = -100;
    this.orthocam.far = 100;

    this.orthocam.updateProjectionMatrix();

    this.background.scale.set(width, height, 1);
    this.background.position.set(width/2,height/2,0);

    this.clear(0x0000ff);
  },
  setImageData: function( img, tilesize ) {
    this.setSize(img.width, img.height);
    
    tilesize = tilesize || 512;

    var x = 0,
        y = 0;

    for (var i = 0; i < img.width / tilesize; i++) {
      for (var j = 0; j < img.height / tilesize; j++) {
        requestIdleCallback(function(i, j) {
          createImageBitmap(img, i * tilesize, j * tilesize, tilesize, tilesize)
            .then(this.blit.bind(this, i * tilesize, j * tilesize));
        }.bind(this, i, j));
      }
    }
  },
  render: function() {
	  var oldAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.orthocam, this);
    this.renderer.autoClear = oldAutoClear;
  },
  clear: function(color) {
    this.background.visible = true;
    this.background.material.color.set(color);
    this.render();
    this.background.visible = false;
  },
  blit: function( x, y, src ) {
    var texture = new THREE.Texture(src);
    texture.image = src;
    //console.log('blit it!', x, y, src, texture);
    texture.needsUpdate = true;
    this.tile.material.map = texture;
    this.tile.scale.set(src.width, -src.height, 1);
    this.tile.position.set(x + src.width/2, this.height - (y + src.width/2), 1);
    this.tile.visible = true;
    this.render();
    this.tile.visible = false;
    texture.image = null;
    texture.dispose();
  },
  finalize: function() {
    // TODO - perform any postprocessing or clean-up here
console.log('done');
    texture = this.texture;
    this.texture = null; // so the webgl texture is not deleted by dispose()
    this.dispose();
    this.texture = texture;
  }
});

function FramebufferTextureLoader( manager ) {

	this.manager = ( manager !== undefined ) ? manager : THREE.DefaultLoadingManager;

}

Object.assign( FramebufferTextureLoader.prototype, {
  tilesize: 512,

	load: function ( url, onLoad, onProgress, onError ) {
    var texture = new FramebufferTexture(16, 16, {});
    var tilesize = this.tilesize;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.onload = function(ev) {
      var data = xhr.response;
      createImageBitmap(data).then(function(img) {
        texture.setImageData(img, tilesize);
      }).catch(function(e) {
        console.log('error!', e);
      });
    }
    xhr.send(null);

    return texture;
  }
});
function FramebufferTextureLoaderWorker( manager ) {

	this.manager = ( manager !== undefined ) ? manager : THREE.DefaultLoadingManager;

}

Object.assign( FramebufferTextureLoaderWorker.prototype, {
  tilesize: 512,

	load: function ( url, onLoad, onProgress, onError ) {
    var texture = new FramebufferTexture(16, 16, {});
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
console.log('parser begins', data, tilesize);
      var blob = new Blob([data.bytes], {type: data.type});

      createImageBitmap(blob).then(function(img) {
        postMessage({type: 'resize', size: [img.width, img.height]});

        // TODO - handle non-PoT textures too!
        var tilecols = img.width / tilesize,
            tilerows = img.height / tilesize;

        var promises = [];
        for (var x = 0; x < tilecols; x++) {
          for (var y = 0; y < tilerows; y++) {
            (function(x, y) {
              var promise = new Promise(function(resolve, reject) { 
                createImageBitmap(img, x * tilesize, y * tilesize, tilesize, tilesize)
                  .then(function(imagedata) {
                    postMessage({type: 'tile', data: {x: x * tilesize, y: y * tilesize, tilesize: tilesize, image: imagedata}}, [imagedata]);
                    resolve();
                  });
              });
              promises.push(promise);
            })(x, y);
          }
        }
        Promise.all(promises).then(function() {
          postMessage({type: 'complete'});
        });
      }).catch(function(e) {
        console.log('error!', e);
      });
    };

    var workercode = 'var parser = ' + parser.toString() + ';\nonmessage = function ( e ) { parser( e.data, ' + tilesize + ' ); }';
    var blob = new Blob( [ workercode ], { type: 'text/plain' } );
    var worker = new Worker( window.URL.createObjectURL( blob ) );
    worker.addEventListener( 'message', function ( e ) {
      var msg = e.data;
      if (msg.type == 'resize') {
        //console.log('image resize', msg.data);
        texture.setSize(msg.size[0], msg.size[1]);
      } else if (msg.type == 'tile') {
        //console.log('got a tile!', msg);
        texture.blit(msg.data.x, msg.data.y, msg.data.image);
      } else if (msg.type == 'complete') {
        texture.finalize();
        worker.terminate();
      }
    } );
    worker.postMessage({type: type, bytes: data, tilesize: tilesize }, [data]);
  }
});
