'use strict';

var doT = require('doT');

exports.translate = function(load) {
    doT.templateSettings.strip = false;
    return 'module.exports = ' + doT.compile(load.source) + ';';
};
