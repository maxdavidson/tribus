#!/bin/bash

#npm install -g jspm
#jspm install

jspm bundle-sfx lib/extra/globalizer dist/tribus.js
jspm bundle-sfx lib/extra/globalizer dist/tribus.min.js --minify --skip-source-maps

cat jspm_packages/babel-polyfill.js dist/tribus.js > tmp && mv tmp dist/tribus.js
cat jspm_packages/babel-polyfill.js dist/tribus.min.js > tmp && mv tmp dist/tribus.min.js
