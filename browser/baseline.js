'use strict'
var Mousetrap = require('mousetrap');

var merge = function(src, dest) {
	for (let prop in src) { 
		if (prop in dest) { continue; }
		dest[prop] = src[prop];
	}
}

/* From jQuery: dimensions.js */
function getDimension(elem, name) {
	if (elem === window) {
		var docElemProp = elem.document.documentElement[ "client" + name ],
		body = elem.document.body;
		return elem.document.compatMode === "CSS1Compat" && docElemProp ||
			body && body[ "client" + name ] || docElemProp;    
	} else {
		return Math.max(
			elem.documentElement["client" + name],
			elem.body["scroll" + name], elem.documentElement["scroll" + name],
			elem.body["offset" + name], elem.documentElement["offset" + name]
		);
	}
}

var Baseliner = function(options) {
	var defaults = {
		'color': [196, 196, 196],
		'height': 24,
		'offset': 0,
		'opacity': 100,
		'space': 1
	}
	if (options == null) {
		options = {};
	} else {
		var optint = parseInt(options);
		if (optint != 0 && !isNaN(optint) ) {
			options = { 'height': optint };
		}
	}
	merge(defaults, options);
	this.opts = options;
	
	var baseliner = this;
	this.overlayId = 'baseline-overlay'
	this.overlay = null;

	this.resize = function() {
		if (!this.overlay) return;

		let height = getDimension(document, "Height");
		let width = getDimension(window, "Width");
		this.overlay.style.width = width + "px";
		this.overlay.style.height = height + "px";
	}
	this.create = function() {
		var _already_overlaid = document.getElementById(this.overlayId);
		if (_already_overlaid) return;

		this.overlay = document.createElement('div');
		this.overlay.id = this.overlayId;
		document.body.appendChild(this.overlay);
		var svgURL = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='" + this.opts.space + "' height='" + this.opts.height + "'><rect style='fill: " + this.opts.color + ";'  width='1' height='0.25px' x='0' y='" + (this.opts.height - 1) + "'/></svg>\")";
		this.overlay.style.backgroundImage = svgURL;
		this.overlay.style.position = 'absolute';
		this.overlay.style.top = this.opts.offset + 'px';
		this.overlay.style.left = '0px';
		this.overlay.style.zIndex = 9998;
		this.overlay.style.pointerEvents = 'none';
		this.overlay.style.opacity = this.opts.opacity / 100;
		this.resize()
	}
	this.toggle = function(forced) {
		if (forced) {
			var elem = document.getElementById(this.overlayId);
			if (elem) {
				document.body.removeChild(elem);
			}
		}
		this.create();
		if (forced || this.overlay.style.display != 'block') {
			this.overlay.style.display = 'block';
		} else {
			this.overlay.style.display = 'none';
		}
	}
	this.refresh = function(value) {
		var value = parseInt(value);
		if (value < 1 || isNaN(value)) {
			this.value = baseliner.opts.height;
			baseliner.grid_size.style.backgroundColor = "red";
			baseliner.grid_size.style.color = "white";
			return;
		}
		baseliner.grid_size.style.backgroundColor = "white";
		baseliner.grid_size.style.color = "black";
		if (baseliner.overlay) {
			document.body.removeChild(baseliner.overlay);
			baseliner.overlay = null;
		}
		baseliner.opts.height = value;
		baseliner.toggle(true);
	}
	this.refreshOffset = function(value) {
		var value = parseInt(value);
		if (value < 0 || isNaN(value)) {
			this.value = baseliner.opts.offset;
			baseliner.grid_offset.style.backgroundColor = "red";
			baseliner.grid_offset.style.color = "white";
			return;
		}
		baseliner.grid_offset.style.backgroundColor = "white";
		baseliner.grid_offset.style.color = "black";
		if (baseliner.overlay) {
			document.body.removeChild(baseliner.overlay);
			baseliner.overlay = null;
		}
		baseliner.opts.offset = value;
		baseliner.toggle(true);
	}

	let init = function() {
		switch(baseliner.opts.color) {
			case 'green':
			baseliner.opts.color = [0, 0xFF, 0]; break;
			case 'blue':
			baseliner.opts.color = [0, 0, 0xFF]; break;
			case 'red':
			baseliner.opts.color = [0xFF, 0, 0]; break;
			case 'black':
			baseliner.opts.color = [0, 0, 0]; break;
		}
		// convert the array to rgb
		baseliner.opts.color = "rgb(" + baseliner.opts.color[0] + "," + baseliner.opts.color[1] + "," + baseliner.opts.color[2] + ")";
				
		window.onresize = function() {
			baseliner.resize();
		};
	}
	init();
}

module.exports = function (mikser) {
	let baseliner = new Baseliner(mikser.config.baseline);

	Mousetrap.bind(['command+b', 'ctrl+b'], () => {
		baseliner.toggle();
		return false;
	});
};