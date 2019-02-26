"use strict";

require("core-js/modules/es6.array.sort");

require("core-js/modules/es7.symbol.async-iterator");

require("core-js/modules/es6.symbol");

require("core-js/modules/web.dom.iterable");

require("core-js/modules/es6.weak-map");

require("core-js/modules/es6.map");

const DataStream = require("../../").DataStream;

const DefaultBufferLength = 16;

const wrapComparator = comparator => (a, b) => comparator(a[0], b[0]);

const DefaultComparator = (a, b) => {
  if (a < b) return -1;
  if (b < a) return 1;
  return 0;
};

module.exports = (multi, passedComparator, bufferLength, Clazz) => {
  bufferLength = bufferLength || DefaultBufferLength;
  Clazz = Clazz || DataStream;
  const comparator = wrapComparator(passedComparator || DefaultComparator);
  const out = new Clazz();
  const readIndex = new Map();
  const endIndex = new WeakMap();
  const rest = [];

  const onceTouchedStream = stream => {
    return Promise.race([new Promise(res => stream.on("readable", res)), endIndex.get(stream)]);
  };

  const getMoreItemsForEntry = (stream, arr) => {
    while (arr.length < bufferLength) {
      let haveMore = stream.read();
      if (haveMore !== null) arr.push(haveMore);else break;
    }

    if (arr.length || !readIndex.has(stream)) return Promise.resolve(arr);
    return onceTouchedStream(stream).then(() => getMoreItemsForEntry(stream, arr), () => Promise.resolve(arr));
  };

  const getMoreItems = () => {
    const ret = [];
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = readIndex.entries()[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        let entry = _step.value;
        ret.push(getMoreItemsForEntry(...entry));
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return != null) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }

    if (!ret.length) return Promise.resolve([]);
    return Promise.all(ret);
  }; // TODO: rewrite as generator?


  const getSorted = inArys => {
    const arr = [];
    const arys = inArys.slice();
    let min_length = 0;
    let j = 0;

    if (rest.length) {
      arys.push(rest);
    }

    if (!arys.length) return [];

    while (true) {
      // eslint-disable-line
      let cnt = 0;
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = arys[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          let ary = _step2.value;
          cnt += ary.length > j;
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
            _iterator2.return();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }

      if (cnt === arys.length) {
        for (let i = 0; i < arys.length; i++) {
          arr.push([arys[i][j], i, j, arys[i].length - j - 1]);
        }

        min_length = ++j;
      } else {
        break;
      }
    }

    arr.sort(comparator);
    const ret = [];

    while (min_length > 0 && arr.length > 0) {
      const item = arr.shift();
      arys[item[1]].shift(item[2]);
      ret.push(item[0]);
      min_length = item[3];
    }

    return ret;
  };

  const writeSorted = sorted => {
    let ret = true;

    for (var i = 0; i < sorted.length; i++) {
      ret = out.write(sorted[i]);
    }

    return ret || new Promise(res => out.once("drain", () => res(sorted.end)));
  };

  let removing = null;
  let pushing = null;

  const pushMoreItems = () => {
    if (pushing) return pushing;
    pushing = getMoreItems().then(arys => getSorted(arys)).then(writeSorted).catch(e => e instanceof Error ? out.emit("error", e) : (pushing = null, Promise.resolve())).then(() => {
      pushing = null;

      if (readIndex.size) {
        pushMoreItems();
      } else if (rest.length) {
        return writeSorted(rest.sort(passedComparator));
      }
    });
    return pushing;
  };

  const onEmpty = () => {
    return Promise.resolve(pushing).then(() => out.end());
  };

  multi.each(addedStream => {
    const endPromise = new Promise((res, rej) => addedStream.on("end", () => {
      multi.remove(addedStream);
      rej();
    }));
    endPromise.catch(() => 0);
    readIndex.set(addedStream, []);
    endIndex.set(addedStream, endPromise);
  }, removedStream => {
    removing = Promise.all([getMoreItemsForEntry(removedStream, readIndex.get(removedStream)).then(items => {
      readIndex.delete(removedStream);
      rest.push(...items);
    }), removing]).then(() => readIndex.size ? pushMoreItems() : onEmpty());
  }).then(pushMoreItems).catch(e => out.emit("error", e));
  return out;
};