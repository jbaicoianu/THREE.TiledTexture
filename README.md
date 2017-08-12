# THREE.TiledTexture
### A tiled texture loader proposal for Three.js

One of the biggest challenges to WebGL and (more specifically) WebVR projects right now is the efficient loading of textures to the GPU.  Uploading a 4096x4096 or larger texture to the gpu can block for a second or more, causing uncomfortable frame drops while new content streams in over the network and is uploaded to the GPU.  On mobile the situation is even more constrained, and we often need to downscale our images to fit within their more limited constraints, as well.

Here we propose a tiled framebuffer approach, which uses WebWorkers and createImageBitmap to efficiently split large textures into manageable tiles of a known size.  These tiles can be uploaded to the GPU to fill in the textures over a series of frames, allowing us to meter out the updates to accomodate our frametime budgets.  Here we show a system which can upload a 16384x16384 texture to a running scene with no framedrop.  An even more advanced system could adjust tile sizes dynamically based on realtime performance metrics, allowing us to adapt to the most efficient settings for the device automatically.

The API for using this is the same as any other TextureLoader, with one exception - the TiledTextureLoader needs a reference to the renderer.

```javascript
        renderer = new THREE.WebGLRenderer();
        loader = new TiledTextureLoader();
        loader.setRenderer( renderer );
        
        var texture1 = loader.load('texture1.png');
        var texture2 = loader.load('texture2.png');
        ...
        var material1 = new THREE.MeshPhongMaterial({map: texture1, normalMap: texture2});
        ...
```

Behind the scenes though, it works very differently from the current simple TextureLoader.  With the existing ```THREE.TextureLoader```, calling ```loader.load()``` returns a ```THREE.Texture``` object, creates an ```Image()``` object, and sets its src to the requested URL.  Once it's loaded, it tells the renderer that the texture ```needsUpdate``` - however, this does NOT trigger an immediate texture load - the texture will not be uploaded to to the GPU until an object which references that texture is rendered (ie, it's in the view frustum of the currently active camera for this frame).  This is the most significant cause of "jankiness" when looking around worlds with lots of textures - the first time through a scene, you'll be loading in new textures every time you turn your head - until finally you've looked 360 degrees all around, at which point all the textures are on the GPU and everything runs smoothly.  Experiences which show loading screens can force a GPU texture upload by rendering each object to a framebuffer at least once during this initialization step, but apps which aim to stream new content in dynamically must find a way to deal with new textures without incurring frame drops.

## TiledTextureLoader

```TiledTextureLoader``` is our proposal to fix that problem, and works very differently under the hood.  Instead of creating an ```Image``` object and returning a ```THREE.Texture``` which references it, we queue up an XHR to download the image as an ```ArrayBuffer```, and return a ```THREE.WebGLRenderTarget``` object.  This rendertarget represents a framebuffer on the GPU, and we initialize it with some default image data - either plain black, or we can get fancy and have a checker pattern grid or other effect.  The creation of this framebuffer is immediate, there is no pixel data being uploaded to the GPU - just one draw call to init the buffer.

When our asynchronous XHR request has finished, we then create a ```WebWorker```, and transfer the binary image data directly into this worker via ```postMessage()```.  Inside of this worker, we turn this ```ArrayBuffer``` into a ```Blob```, then we use ```createImageBitmap()``` to decode the image and turn it into a format that we can use for our WebGL textures.  This is step one - for now, the loader is done, and it waits patiently for the next step.

The next step is either triggered the same way as before when the object which references our ```TiledTexture``` is rendered for the first time, or if desired can be told to begin loading immediately.  Either way, when this happens we can start requesting tiles from our worker, which we do by sending it messages with ```postMessage()```.  The worker then starts the work of splitting up the full-sized image into smaller, more manageable tiles.  This is trivial to do with ```createImageBitmap()```, but at the time of this writing (8/11/2017) some browser bugs/limited implementations prevent us from utilizing it to its fullest potential (TODO - clarify more!  file bugs!).  As the tiles are returned, we can then use an ```OrthographicCamera``` to render them into the proper location within the framebuffer, and we can use ```requestIdleCallback()``` to manage this in a way which doesn't load more tiles than we can handle per frame.





