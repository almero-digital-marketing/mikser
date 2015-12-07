'use strict'

var marked = require('marked');
var S = require('string');
var fs = require('fs-extra');
var removeMd = require('remove-markdown');

module.exports = function (mikser, context) {
	let renderer = new marked.Renderer();
	if (context) {
		renderer.heading = function (text, level) {
			var escapedText = S(text.toLowerCase()).replaceAll(' ','-').s;
			return '<h' + level + ' id="' + escapedText + '">' + text + '</h' + level + '>';
		};

		context.markdown = function (content) {
			return marked(content, { renderer: renderer });
		}

		context.removeMarkdown = function (content) {
			return removeMd(content);
		}		
	} else {
		mikser.renderengine.engines.push({
			pattern: '**/*.md',
			render: function(context) {
				return marked(context.content, { renderer: renderer });
			}
		});		
	}
};