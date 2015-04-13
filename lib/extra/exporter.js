import * as Tribus from '../tribus';

// CommonJS exporter
if (typeof module !== 'undefined') {
    module.exports = Tribus;
} else {
    window.Tribus = Tribus;
}
