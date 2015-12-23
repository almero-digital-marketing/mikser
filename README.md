<p align="center"><a href="https://www.npmjs.com/package/mikser" target="_blank"><img width="300" src="http://almero.pro/mikser.svg"></a></p>

## Mikser is a real-time static site generator
Mikser is designed for rapid web site development. It works equally well for small web sites and for large multi domain, multi language sites with thousands of pages and very complex generation logic. 

- Multi-threaded cluster rendering with incredible performance
- LiveReload with real-time preview no matter if the web site has 10 or 10'000 pages
- Built-in multi-language and multi-domain support
- Pin-point diagnostics that provides accurate error messages
- Easy integration with build systems like [Grunt](http://gruntjs.com/) and [Gulp](http://gulpjs.com/) or CSS pre-processors like [Less](http://lesscss.org/) and [Sass](http://sass-lang.com/)
- Support for most of the popular template and markup engines - [Jade](http://jade-lang.com/), [Eco](https://github.com/sstephenson/eco), [Ect](http://ectjs.com/), [Ejs](http://ejs.co/), [Swig](http://paularmstrong.github.io/swig/), [Markdown](http://daringfireball.net/projects/markdown/), [Textile](http://redcloth.org/textile/), [Yaml](http://www.yaml.org/), [Toml](https://github.com/toml-lang/toml), [ArchieML](http://archieml.org/), [CSON](https://github.com/bevry/cson), [JSON5](http://json5.org/), support for new engines through plug-ins
- Very easy plug-in system with straight forward interface and hot reload

## Installation
Mikser works well on Windows, Linux and OSX. It can be installed both globally and as a local dependency. It comes with all contrib plugins build-in.

1. Node.js &ge; 4.0
2. MongoDB &ge; 2.4 (Under Windows you should add MongoDB's `bin` folder to your `PATH` environment variable. Default location: `C:\Program Files\MongoDB\Server\3.0\bin`)

### Using mikser as a command line tool
1. Install Mikser with `npm install -g mikser`
2. Create a folder for your project, run `mikser` inside it

### Using mikser from inside a script
1. Install mikser as local dependency of mikser inside this folder with `npm install mikser`
2. Create `mikser.js` and put those lines inside 
3. Start your first Mikser app with `node mikser`

```js
var mikser = require('mikser');
mikser.run();
```

## Fist run
After you run Mikser for the first time it will create all the necessary folders inside and then start watching your folder for changes and auto-generate your web site.
