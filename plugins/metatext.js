'use strict'

var S = require('string');

module.exports = function (mikser, context) {
	context.removeMetatext = function(content) {
		return S(content)
			.replaceAll('<','')
			.replaceAll('>','')
			.replaceAll('{','')
			.replaceAll('}','')
			.replaceAll('(','')
			.replaceAll(')','')
			.replaceAll('[','')
			.replaceAll(']','')
			.replaceAll('|',' ')
			.replaceAll('_',' ').s;
	};
	context.metatext = function(content) {
		return S(content)
			.replaceAll('<','<<')
			.replaceAll('>','>>')
			.replaceAll('<<','<s>')
			.replaceAll('>>','</s>')
			.replaceAll('{','<u>')
			.replaceAll('}','</u>')
			.replaceAll('(','<b>')
			.replaceAll(')','</b>')
			.replaceAll('[','<i>')
			.replaceAll(']','</i>')
			.replaceAll('|','<br>')
			.replaceAll('_','<hr>').s;
	};
};