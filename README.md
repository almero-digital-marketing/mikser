<p align="center"><a href="http://mikser.io" target="_blank"><img width="300" src="http://almero.pro/mikser.svg"></a></p>

## Mikser is a real-time static site generator
Mikser is designed for rapid web site development. It works equally well for small web sites and for large multi domain, multi language sites with thousands of pages and very complex generation logic. 

- Multi-threaded cluster rendering with incredible performance
- LiveReload with real-time preview no matter if the web site has 10 or 10'000 pages
- Built-in multi-language and multi-domain support
- Pin-point diagnostics that provides accurate error messages
- Easy integration with build systems like [Grunt](http://gruntjs.com/) and [Gulp](http://gulpjs.com/)
- Support for most popular layout engines - [Jade](http://jade-lang.com/), [Eco](https://github.com/sstephenson/eco), [Ect](http://ectjs.com/), [Ejs](http://ejs.co/), [Swig](http://paularmstrong.github.io/swig/)
- Support for most popular markup languages - [Markdown](http://daringfireball.net/projects/markdown/), [Textile](http://redcloth.org/textile/)
- Very easy plug-in system with straight forward interface and hot reload

## Installation
Mikser works well on Windows, Linux and OSX. It is installed as local npm module and comes with all contrib plugins build-in. It has some external dependencies that has to be installed in advance.

1. Node.js &ge; 4.0 (Node.js &ge; 0.12 with --harmony flag)
2. Mongodb &ge; 2.4 (On Windows you should add Mongo's `bin` folder to your `PATH` environment variable. Default location: `C:\Program Files\MongoDB\Server\3.0\bin`)

## First run
1. Create a folder for your project
2. Install Mikser with `npm install mikser`
3. Create `mikser.js` inside this folder 
4. Add this inside `require('mikser').run()`
5. `node mikser`
