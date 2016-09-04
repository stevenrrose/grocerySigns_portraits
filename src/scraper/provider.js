/*
 *
 * Generic provider class.
 *
 */

var Provider = function(name, /* TODO remove */ urlPattern) {
    this.name = name;
    this.urlPattern = urlPattern;
    this._listeners = {};
    
    return this;
};

/**
 * EventTarget interface.
 */
Provider.prototype.addEventListener = function(type, callback) {
    if (!(type in this._listeners)) {
        this._listeners[type] = [];
    }
    this._listeners[type].push(callback);
};
Provider.prototype.removeEventListener = function(type, callback) {
    if (!(type in this._listeners)) {
        return;
    }
    var stack = this._listeners[type];
    var index = stack.indexOf(callback);
    if (index !== -1) {
        this._listeners.splice(index, 1);
    }
};
Provider.prototype.dispatchEvent = function(event) {
    if (!(event.type in this._listeners)) {
        return;
    }
    var stack = this._listeners[event.type];
    event.target = this;
    for (var i = 0, l = stack.length; i < l; i++) {
        stack[i].call(this, event);
    }
};
