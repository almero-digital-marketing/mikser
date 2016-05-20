'use strict'
let _ = require('lodash');
let S = require('string');

module.exports = function (mikser, context) {

	context.collection = function (source, destination) {
		let offload = false;
		if (_.isString(source)) {
			if (!destination) destination = source;
			context.data[destination] = context.data[source];
		} else {
			if (!destination) {
				destination = _.uniqueId();
				offload = true;
			}
			context.data[destination] = source;
		}
		context.data[destination] = context.data[destination] || [];

		let collectionInfo = {
			shuffle: function () {
				context.data[destination] = _.shuffle(context.data[destination]);
				return this;
			},

			skip: function (number) {
				context.data[destination] = context.data[destination].slice(number);
				return this;
			},

			take: function (number) {
				context.data[destination] = _.take(context.data[destination], number);
				return this;
			},

			prepend: function (array) {
				array = array || [];
				if (!_.isArray(array)) {
					array = [array];
				}
				context.data[destination] = array.concat(context.data[destination]);
				return this;
			},

			append: function (array) {
				array = array || [];
				if (!_.isArray(array)) {
					array = [array];
				}
				context.data[destination] = context.data[destination].concat(array);
				return this;
			},

			sample: function (number) {
				number = number || 1;
				context.data[destination] = [].concat(_.sampleSize(context.data[destination], number));
				return this;
			},

			sort: function (by, order) {
				order = order || 'asc';
				context.data[destination] = _.orderBy(context.data[destination], [by], [order]);
				return this;
			},

			map: function (action) {
				context.data[destination] = _.map(context.data[destination], action);
				return context.data[destination];
			},

			filter: function (predicate) {
				context.data[destination] = _.filter(context.data[destination], predicate);
				return this;
			},

			uniq: function () {
				context.data[destination] = _.uniq(context.data[destination]);
				return this;
			},
		}

		Object.defineProperty(collectionInfo, 'items', {
			get: function () {
				let result = context.data[destination];
				if (offload) {
					delete context.data[destination];
				}
				return result;
			}
		});

		Object.defineProperty(collectionInfo, 'last', {
			get: function () {
				let result = context.data[destination][context.data[destination].length - 1];
				if (offload) {
					delete context.data[destination];
				}
				return result;
			}
		});

		Object.defineProperty(collectionInfo, 'first', {
			get: function () {
				let result = context.data[destination][0];
				if (offload) {
					delete context.data[destination];
				}
				return result;
			}
		});

		return collectionInfo;
	}
}
