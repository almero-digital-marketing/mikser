<p align="center"><a href="https://www.npmjs.com/package/mikser" target="_blank"><img width="300" src="http://almero.pro/mikser.svg"></a></p>

## Mikser is a real-time static site generator
Mikser is designed for rapid web site development. It works equally well for small web sites and for large multi domain, multi language sites with thousands of pages and very complex generation logic. 

- Multi-threaded cluster rendering with incredible performance
- LiveReload with real-time preview no matter if the web site has 10 or 10'000 pages
- Built-in multi-language and multi-domain support
- Pin-point diagnostics that provides accurate error messages
- Easy integration with build systems like [Grunt](http://gruntjs.com/) and [Gulp](http://gulpjs.com/), CSS pre-processors like [Less](http://lesscss.org/) and [Sass](http://sass-lang.com/) or compilators like [CoffeeScript](http://coffeescript.org/) and [TypeScript](http://www.typescriptlang.org/)
- Support for most of the popular template and markup engines - [Jade](http://jade-lang.com/), [Eco](https://github.com/sstephenson/eco), [Ect](http://ectjs.com/), [Ejs](http://ejs.co/), [Swig](http://paularmstrong.github.io/swig/), [Nunjucks](http://mozilla.github.io/nunjucks/), [Twig](http://twig.sensiolabs.org/), [Markdown](http://daringfireball.net/projects/markdown/), [Textile](http://redcloth.org/textile/), [YAML](http://www.yaml.org/), [TOML](https://github.com/toml-lang/toml), [ArchieML](http://archieml.org/), [CSON](https://github.com/bevry/cson), [JSON5](http://json5.org/), support for new engines through plug-ins
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

## Performance
We have have tried many static site generators they work well for simple web sites, but in real-life scenarios they degrade performance very fast. Here is what we have found, playing around with some of them.

For a simple web site with around 200 pages [DocPad](http://docpad.org/) takes about 1 minute, [Hexo](https://hexo.io/) takes 2 minutes and Mikser takes 7 seconds. For a complex web site with 1000 pages and templates with blocks and partials, Mikser takes about 30 seconds while [DocPad](http://docpad.org/) and [Hexo](https://hexo.io/) take almost 30 minutes. We haven't tried [Hugo](https://gohugo.io/) with the same sites because it lacks plug-ins and it is very hard to extend and reuse existing templates but from some basic web sites we have implemented with it we found that it has almost the same performance as Mikser, when templates get more complex it is slower by much.

All static site generators that we have tested perform a full regeneration on every run. Mikser has build-in change tracking and only generates what has been affected by the change so most of the time it is ready for less than 5 seconds, when [DocPad](http://docpad.org/) and [Hexo](https://hexo.io/) take 30 minutes to finish.

# Example web sites
You can check one of our projects [Dialog](https://github.com/almero-digital-marketing/dialog-web). It has relatively simple structure, with four languages in different domains. The project was originally implemented with [DocPad](http://docpad.org/). It took us 3 days to convert it to Mikser and we managed to reuse most of the templates with minor changes.

```
git clone https://github.com/almero-digital-marketing/dialog-web.git
cd dialog-web
npm i
npm start
```

## Mikser documentation

* [Folder structure](https://github.com/almero-digital-marketing/mikser-docs/blob/master/folders.md)
* [Documents](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md)
	* [Structured data documents](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#structured-data-documents)
	* [Markup documents with front matter](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#markup-documents-with-front-matter)
	* [Anything with front matter](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#anything-with-front-matter)
	* [Meta data routing](https://github.com/almero-digital-marketing/mikser-docs/blob/master/documents.md#meta-data-routing)
* [Layouts](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md)
	* [Basic layout usage](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#basic-layout-usage)
	* [Referring meta data](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#referring-meta-data)
	* [Layout inheritance](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#layout-inheritance)
	* [Using data queries](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#using-data-queries)
		* [Layout queries](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#layout-queries)
		* [Context queries](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#context-queries)
	* [Referring other documents from layouts](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#referring-other-documents-from-layouts)
	* [Blocks (Partials)](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#blocks-partials)
		* [Using plain blocks](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#using-plain-blocks)
		* [Using blocks with options](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#using-blocks-with-options)
	* [Short codes](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#short-codes)
	* [Paging](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#paging)
	* [Using auto layouts](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#using-auto-layouts)
* [External tools](https://github.com/almero-digital-marketing/mikser-docs/blob/master/tools.md)
	* [Preprocessors and compilators](https://github.com/almero-digital-marketing/mikser-docs/blob/master/tools.md#preprocessors-and-compilators)
	* [Build systems](https://github.com/almero-digital-marketing/mikser-docs/blob/master/tools.md#build-systems)
* [Development server](https://github.com/almero-digital-marketing/mikser-docs/blob/master/server.md)
	* [Live reload](https://github.com/almero-digital-marketing/mikser-docs/blob/master/server.md#live-reload)
	* [Real-time preview](https://github.com/almero-digital-marketing/mikser-docs/blob/master/server.md#real-time-preview)
	* [Watching folders](https://github.com/almero-digital-marketing/mikser-docs/blob/master/server.md#watching-folders)
* [Debugging](https://github.com/almero-digital-marketing/mikser-docs/blob/master/debugging.md)
	* [Error diagnostics](https://github.com/almero-digital-marketing/mikser-docs/blob/master/debugging.md#error-diagnostics)
	* [Debug information](https://github.com/almero-digital-marketing/mikser-docs/blob/master/debugging.md#debug-information)
* Plug-ins
	* Layout plug-ins
	* System plug-ins
	* Build-in plug-ins
		* Markup and template plug-ins
		* Collections plug-in
		* Images plug-in
		* Videos plug-in
		* Versions plug-in
		* Caching plug-in
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