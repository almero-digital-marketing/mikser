'use strict'

var marked = require('marked');
var S = require('string');
var fs = require('fs-extra');
var removeMd = require('remove-markdown');

module.exports = function (mikser, context) {
	if (context) {
		context.markdown = function (content) {
			if (!content) return '';
			if (typeof content != 'string' && content != undefined) {
				throw new Error('Argument is not a string');
			}
			let renderer = new marked.Renderer();
			renderer.heading = function (text, level) {
				return '<h' + level + '>' + text + '</h' + level + '>';
			};
			return marked(content, { renderer: renderer });
		}

		context.removeMarkdown = function (content) {
			if (content) {
				return removeMd(content);
			}
			return content;
		}		
	} else {
		mikser.manager.extensions['.md'] = '.html';
		mikser.generator.engines.push({
			extensions: ['md'],
			pattern: '**/*.md',
			render: function(context) {
				let renderer = new marked.Renderer();
				let idMap = {};
				renderer.heading = function (text, level) {
					let id = S(text.toLowerCase()).stripTags().replaceAll(' ','-').s;
					let globalId = id;
					let globalCounter = 1;
					while (idMap[globalId]) {
						globalId = id + '-' + globalCounter++;
					}
					idMap[globalId] = true;
					return '<h' + level + ' id="' + globalId + '">' + text + '</h' + level + '>';
				};
				return marked(context.content, { renderer: renderer });
			}
		});		
	}
};