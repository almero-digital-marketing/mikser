'use strict'
let Mousetrap = require('mousetrap');
let $ = require('jquery');
// let Clipboard = require('clipboard');
let GUIDE_PREFIX = 'guide';

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

	$('<a id="mikser-guide"><a/>')
		.css({
			'pointer-events': 'none',
			'position': 'fixed',
			'bottom': '0',
			'right': '0',
			'z-index': '999'
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
		var holder = $(treeWalker.currentNode).parent();
		if (prevChild.is('img')) {
			holder = $(treeWalker.currentNode).prev();
		}

		let guide = treeWalker.currentNode.nodeValue.trim();
		holder
			.data('mikser-guide', guide)
			.addClass('mikser-guide')
			.hover(function(){
				$('#mikser-guide').text($(this).data('mikser-guide'));
				$('#mikser-guide').show();
			}, function(){ 
				$('#mikser-guide').hide(); 
			});
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