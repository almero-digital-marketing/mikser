'use strict'
var Mousetrap = require('mousetrap');
var $ = require('jquery');
require('tipso');

var Clipboard = require('clipboard');
var GUIDE_PREFIX = 'guide';
var enabled;

function filter(node) {
	var text = node.nodeValue.trim();
	if (text.substring(0, GUIDE_PREFIX.length) !== GUIDE_PREFIX) {
		return NodeFilter.FILTER_SKIP;
	} else {
		return NodeFilter.FILTER_ACCEPT;
	}
}

$(function() {
	if (!document.createTreeWalker) return;

	var treeWalker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_COMMENT,
		{ acceptNode: filter },
		false
	);

	while(treeWalker.nextNode()) {
		var $holder = $(treeWalker.currentNode).parent();
		var $prev =$(treeWalker.currentNode).prev();
		if ($prev.is('img')) $holder = $prev;

		var guide = treeWalker.currentNode.nodeValue.trim();
		$holder
			.data('mikser-guide', guide)
			.addClass('mikser-guide');
	}

});

module.exports = function (mikser) {
	mikser.loadResource('/mikser/browser/guide/style.css');
	var clipboard = new Clipboard('.mikser-guide-copy');
	clipboard.on('success', function(e) {
		$('.mikser-guide-copy').removeClass('mikser-guide-copy');
	});
	Mousetrap.bind(['command+g', 'ctrl+g'], () => {
		if (!enabled) {
			enabled = !enabled;
			$('.mikser-guide').tipso({
				tooltipHover: true,
				width: 'auto',
				delay: 100,
				background: '#323232',
				onBeforeShow: function($element, tipso) {
					var guide = $element.data('mikser-guide');
					var section = guide.replace(GUIDE_PREFIX + '@','').split(':')[0],
						file = guide.split(':/')[1].split('#')[0]
					if (guide.indexOf('#') > -1) {
						var position = guide.split('#')[1];
						var line = position.split('-')[0];
						if (position.indexOf('-') > -1) {
							var column = position.split('-')[1];
						}
					}
					var guideHtml = '<code class="mikser-guide-url">' + 
						'<span class="mikser-guide-prefix">' + GUIDE_PREFIX + '</span>@' + 
						'<span class="mikser-guide-sectoin">' + section + '</span>:/' + 
						'<span class="mikser-guide-file">' + file + '</span>';
					var clipboardHtml = '<a class="mikser-guide-copy" data-clipboard-text="' + file;
					if (line) {
						guideHtml += '#<span class="mikser-guide-line">' + line + '</span>'
						clipboardHtml += ':' + line;
						if (column) {
							guideHtml += '-<span class="mikser-guide-column">' + column + '</span>'
							clipboardHtml += ':' + column;
						}
					}
					clipboardHtml += '">'
					guideHtml += '</code>';
					clipboardHtml += guideHtml + '</a>'
					$element.tipso('update', 'content', clipboardHtml);
				}
			});
		} else {
			enabled = !enabled;
			$('.mikser-guide').tipso('close');
			$('.mikser-guide').tipso('destroy');
		}
		return false;
	});
};