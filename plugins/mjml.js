'use strict'

var mjml = require('mjml');
var fs = require("fs-extra-promise");
var path = require("path");

module.exports = function (mikser, context) {
	if (context) {
		let destInfo = path.parse(context.entity.destination);
		let destination = context.entity.destination.replace(destInfo.ext, '.mjml.html');
		context.process(() => {
			let html = mjml(context.content).html;
			return fs.createFileAsync(destination).then(() => {
				return fs.writeFileAsync(destination, html);							
			});
		})
	}
};