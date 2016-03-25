'use strict'
let Mousetrap = require('mousetrap');
let $ = require('jquery');
// let Clipboard = require('clipboard');
let GUIDE_PREFIX = 'guide';

function insertData(element, guide) {
	element
		.data({'mikser-guide': guide})
		.addClass('mikser-guide');
}

function filter(node) {
	let text = node.nodeValue.trim();
	if (text.substring(0, GUIDE_PREFIX.length) !== GUIDE_PREFIX) {
		return NodeFilter.FILTER_SKIP;
	} else {
		return NodeFilter.FILTER_ACCEPT;
	}
}

$(function() {
	if (!document.createTreeWalker) return;

	// create element for guide content and append it to body
	$('<a id="mikser-guide"><a/>')
		.css({
			'pointer-events': 'none',
			'position': 'absolute',
			'margin-top': '55px',
			'z-index': '1'
		})
		.hide()
		.prependTo('body');

	let treeWalker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_COMMENT,
		{ acceptNode: filter },
		false
	);

	while(treeWalker.nextNode()) {
		let prevChild = $(treeWalker.currentNode).prev(),
				holder;

		if (prevChild.is('img')) {
			holder = prevChild;
		} else {
			holder = $(treeWalker.currentNode).parent();
		}

		insertData(holder, treeWalker.currentNode.nodeValue.trim());
		holder.hover(function(){
			$('#mikser-guide').text($(this).data('mikser-guide'));
			$('#mikser-guide').show();
		}, function(){ $('#mikser-guide').hide(); });
	}

});

module.exports = function (mikser) {

	let clipboard = new Clipboard('#mikser-guide');
	Mousetrap.bind(['command+g', 'ctrl+g'], () => {
		// clipboard.on('success', function(e){
		// 	console.log('Action', e.action);
		// 	console.log('Text', e.text);
		// 	console.log('Trigger:', e.trigger);
		// 	e.clearSelection();
		// });

		// clipboard.on('error', function(e) {
		// 	console.log('Action', e.action);
		// 	console.log('Trigger:', e.trigger);
		// })

		// copy to clipboard
		return false;
	});
};