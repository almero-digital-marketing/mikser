<p align="center"><a href="https://www.npmjs.com/package/mikser" target="_blank"><img width="300" src="http://almero.pro/mikser.svg"></a></p>

## Mikser is a real-time static site generator
Mikser is designed for rapid web site development. It works equally well for small web sites and for large multi domain, multi language sites with thousands of pages and very complex generation logic. 

[![NPM](https://nodei.co/npm/mikser.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/mikser)

- Multi-threaded cluster rendering with incredible performance
- LiveReload with real-time preview no matter if the web site has 10 or 10'000 pages
- Built-in multi-language and multi-domain support
- Pin-point diagnostics that provide accurate error messages
- Easy integration with build systems like [Grunt](http://gruntjs.com/) and [Gulp](http://gulpjs.com/), CSS pre-processors like [Less](http://lesscss.org/) and [Sass](http://sass-lang.com/) or compilators like [Browserify](http://browserify.org/), [Babel](https://babeljs.io/), [CoffeeScript](http://coffeescript.org/), [TypeScript](http://www.typescriptlang.org/) or any onther tool that has CLI
- Support for most of the popular template and markup engines - [Pug aka Jade](http://jade-lang.com/), [Eco](https://github.com/sstephenson/eco), [Ect](http://ectjs.com/), [Ejs](http://ejs.co/), [Swig](http://paularmstrong.github.io/swig/), [Nunjucks](http://mozilla.github.io/nunjucks/), [Twig](http://twig.sensiolabs.org/), [Markdown](http://daringfireball.net/projects/markdown/), [Textile](http://redcloth.org/textile/), [YAML](http://www.yaml.org/), [TOML](https://github.com/toml-lang/toml), [ArchieML](http://archieml.org/), [CSON](https://github.com/bevry/cson), [JSON5](http://json5.org/), support for new engines through plug-ins
- Very easy plug-in system with straight forward interface and hot reload

## Installation
Mikser works well on Windows, Linux and OSX. It can be installed both globally and as a local dependency. It comes with all contrib plugins build-in.

1. Node.js &ge; 4.0
2. MongoDB &ge; 2.4 

### Using mikser as a command line tool
1. Install Mikser with `npm install -g mikser`
2. Create a folder for your project, run `mikser` inside it

### Using mikser from inside a script
```js
var mikser = require('mikser');
var express = require('express');
var cookieParser = require('cookie-parser');
var app = express();
app.use(cookieParser());
mikser({
	workingFolder: '/var/mikser', // Use custom working folder
	app: app, // Use existing Express web server, Default: Mikser will create one
	server: true, // Add Mikser middle-ware. Default: true, if set to false Mikser won't start web server
	watch: false, // Don't watch file system for changes. Default: true
	debug: true, // Enter debug mode. Default: false
	environment: 'dev' // Merge some extra configuration from another config file.
}).run();
```
1. Create `mikser.js` and put these lines inside 
2. Install mikser as local dependency with `npm install mikser`
3. Start your first Mikser app with `node mikser`

## First run
After you run Mikser for the first time it will create all the necessary folders inside your project folder and then start watching for changes and auto-generate your web site.

## Performance
We have have tried many static site generators, they work well for simple web sites, but in real-life scenarios they degrade performance very fast. Here is what we have found, playing around with some of them.

For a simple web site with around 200 pages [DocPad](http://docpad.org/) takes about 1 minute, [Hexo](https://hexo.io/) takes 2 minutes and Mikser takes 6 seconds. For a complex web site with 1000 pages and templates that use blocks and partials, Mikser takes about 20 seconds while [DocPad](http://docpad.org/) and [Hexo](https://hexo.io/) take almost 30 minutes. We haven't tried [Hugo](https://gohugo.io/) with the same sites, because it lacks plug-ins and it was very hard to extend and reuse existing templates. From the basic web sites we have implemented with it, we found that it has almost the same performance as Mikser, but when the complexity of the generation logic raises it is much slower.

All static site generators that we have tested perform a full regeneration on every run. Mikser has build-in change tracking and only generates the pages that have been affected by the change. Most of the time Mikser is ready for less than 3 seconds, when [DocPad](http://docpad.org/) and [Hexo](https://hexo.io/) take 30 minutes to finish.

## Examples
You can check one of our projects [Dialog](https://github.com/almero-digital-marketing/dialog-web). It has simple structure with four languages in different domains. The project was originally implemented with [DocPad](http://docpad.org/). It took us 3 days to convert it to Mikser and we managed to reuse most of the templates with minor changes.

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
		* [Live queries](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#live-queries)
	* [Referring other documents from layouts](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#referring-other-documents-from-layouts)
	* [Blocks and Partials](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#blocks-and-partials)
		* [Using plain blocks](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#using-plain-blocks-or-partials)
		* [Using blocks with options](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#using-blocks-or-partials-with-options)
	* [Short codes](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#short-codes)
	* [Paging](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#paging)
	* [Using auto layouts](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#using-auto-layouts)
	* [Importing meta data from external file](https://github.com/almero-digital-marketing/mikser-docs/blob/master/layouts.md#importing-meta-data-from-external-file)
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
* [Multi-domain web sites](https://github.com/almero-digital-marketing/mikser-docs/blob/master/domains.md)
	* [Asset replication](https://github.com/almero-digital-marketing/mikser-docs/blob/master/domains.md#asset-replication)
	* [Shared resources](https://github.com/almero-digital-marketing/mikser-docs/blob/master/domains.md#shared-resources)
	* [Virtual hosts](https://github.com/almero-digital-marketing/mikser-docs/blob/master/domains.md#virtual-hosts)
* [Localization](https://github.com/almero-digital-marketing/mikser-docs/blob/master/localization.md)
	* [Multi-language web sites](https://github.com/almero-digital-marketing/mikser-docs/blob/master/localization.md#multi-language-web-sites)
	* [Referring documents from different languages](https://github.com/almero-digital-marketing/mikser-docs/blob/master/localization.md#referring-documents-from-different-languages)
	* [Alternates](https://github.com/almero-digital-marketing/mikser-docs/blob/master/localization.md#alternates)

[![Analytics](https://ga-beacon.appspot.com/UA-78544431-1/README.md?pixel)](https://github.com/igrigorik/ga-beacon)
