<p align="center"><a href="https://www.npmjs.com/package/mikser" target="_blank"><img width="300" src="http://almero.pro/mikser.svg"></a></p>

## Mikser is a real-time static site generator
Mikser is designed for rapid web site development. It works equally well for small web sites and for large multi domain, multi language sites with thousands of pages and very complex generation logic. 

- Multi-threaded cluster rendering with incredible performance
- LiveReload with real-time preview no matter if the web site has 10 or 10'000 pages
- Built-in multi-language and multi-domain support
- Pin-point diagnostics that provides accurate error messages
- Easy integration with build systems like [Grunt](http://gruntjs.com/) and [Gulp](http://gulpjs.com/), CSS pre-processors like [Less](http://lesscss.org/) and [Sass](http://sass-lang.com/) or compilators like [CoffeeScript](http://coffeescript.org/) and [TypeScript](http://www.typescriptlang.org/)
- Support for most of the popular template and markup engines - [Jade](http://jade-lang.com/), [Eco](https://github.com/sstephenson/eco), [Ect](http://ectjs.com/), [Ejs](http://ejs.co/), [Swig](http://paularmstrong.github.io/swig/), [Markdown](http://daringfireball.net/projects/markdown/), [Textile](http://redcloth.org/textile/), [YAML](http://www.yaml.org/), [TOML](https://github.com/toml-lang/toml), [ArchieML](http://archieml.org/), [CSON](https://github.com/bevry/cson), [JSON5](http://json5.org/), support for new engines through plug-ins
- Very easy plug-in system with straight forward interface and hot reload

## Installation
Mikser works well on Windows, Linux and OSX. It can be installed both globally and as a local dependency. It comes with all contrib plugins build-in.

1. Node.js &ge; 4.0
2. MongoDB &ge; 2.4 (Under Windows you should add MongoDB's `bin` folder to your `PATH` environment variable. Default location: `C:\Program Files\MongoDB\Server\3.0\bin`)

### Using mikser as a command line tool
1. Install Mikser with `npm install -g mikser`
2. Create a folder for your project, run `mikser` inside it

### Using mikser from inside a script
```js
var mikser = require('mikser');
mikser.run();
```
1. Create `mikser.js` and put these lines inside 
2. Install mikser as local dependency with `npm install mikser`
3. Start your first Mikser app with `node mikser`

## First run
After you run Mikser for the first time it will create all the necessary folders inside your project folder and then start watching for changes and auto-generate your web site.

## Mikser documentation

* [Folder structure](https://github.com/almero-digital-marketing/mikser-docs/blob/master/folder-structure.md)
* [Documents](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md)
	* [Structured data documents](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#structured-data-documents)
	* [Markup documents with front matter](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#markup-documents-with-front-matter)
	* [Anything with front matter](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#anything-with-front-matter)
	* [Meta data routing](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#meta-data-routing)
* Layouts
	* Basic layout usage
	* Referring meta data
	* Layout inheritance
	* Referring other documents from layouts
	* Using data queries
		* Layout queries
		* Context queries
		* Sorting
	* Blocks/Partials
		* Using plain blocks
		* Using blocks with options
	* Short codes
	* Paging
	* Using auto layouts
* Tools
	* Preprocessors and complicators
	* Using build systems
* Server
	* Live reload
	* Watching folders
	* Real-time preview
* Debugging
	* Error diagnostics
	* Debug information
* Plug-ins
	* Layout plug-ins
	* Mikser plug-ins
	* Build-in plug-ins
		* Collections
		* Markup and template engines plug-ins
		* Images
		* Videos
		* Caching
	* Third-party plug-ins
	* Custom plug-ins
* Multi-language web sites
	* Referring documents from different languages
	* Alternates
* Multi-domain web sites
	* Shared resources
	* Asset replication
* Configuration
* Command line arguments
* Continuous integration