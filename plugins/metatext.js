'use strict'

var S = require('string');

module.exports = function (mikser, context) {
	context.removeMetatext = function(content) {
		if (typeof content != 'string') {
			let err = new Error('Argument is not a string');
			err.origin = 'metatext';
			throw err;
		}
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
			.replaceAll('_',' ')
			.replaceAll('~',' ');
	}
	context.metatext = function(content) {
		if (typeof content != 'string') {
			let err = new Error('Argument is not a string');
			err.origin = 'metatext';
			throw err;
		}
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
			.replaceAll('_','<hr>')
			.replaceAll('~','&nbsp;');
	}
};