'use strict'

module.exports = function (mikser, context) {
	if (!context.document.meta || !context.document.meta.href) return;
	let breadcrumb = [context.document.meta.href];
	let crumb = context.document.meta.href;
	let i = crumb.lastIndexOf('/')
	while (i > 0) {
		crumb = crumb.substr(0,i);
		breadcrumb.unshift(crumb);
		i = crumb.lastIndexOf('/');
	}
	if (breadcrumb.length >= 2) {
		context.parent = breadcrumb[breadcrumb.length - 2];
	}
	context.data.breadcrumb = breadcrumb;
};