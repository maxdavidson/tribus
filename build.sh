#!/bin/bash

#npm install -g jspm
#jspm install

mkdir dist

jspm bundle-sfx lib/extra/exporter dist/tribus.js
jspm bundle-sfx lib/extra/exporter dist/tribus.min.js --minify --skip-source-maps
