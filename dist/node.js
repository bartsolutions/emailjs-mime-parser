'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ramda = require('ramda');

var _timezones = require('./timezones');

var _timezones2 = _interopRequireDefault(_timezones);

var _emailjsMimeCodec = require('emailjs-mime-codec');

var _emailjsAddressparser = require('emailjs-addressparser');

var _emailjsAddressparser2 = _interopRequireDefault(_emailjsAddressparser);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var MimeNode = function () {
  function MimeNode() {
    _classCallCheck(this, MimeNode);

    this.header = []; // An array of unfolded header lines
    this.headers = {}; // An object that holds header key=value pairs
    this.bodystructure = '';
    this.childNodes = []; // If this is a multipart or message/rfc822 mime part, the value will be converted to array and hold all child nodes for this node
    this.raw = ''; // Stores the raw content of this node

    this._state = 'HEADER'; // Current state, always starts out with HEADER
    this._bodyBuffer = ''; // Body buffer
    this._lineCount = 0; // Line counter bor the body part
    this._currentChild = false; // Active child node (if available)
    this._lineRemainder = ''; // Remainder string when dealing with base64 and qp values
    this._isMultipart = false; // Indicates if this is a multipart node
    this._multipartBoundary = false; // Stores boundary value for current multipart node
    this._isRfc822 = false; // Indicates if this is a message/rfc822 node
  }

  _createClass(MimeNode, [{
    key: 'writeLine',
    value: function writeLine(line) {
      this.raw += (this.raw ? '\n' : '') + line;

      if (this._state === 'HEADER') {
        this._processHeaderLine(line);
      } else if (this._state === 'BODY') {
        this._processBodyLine(line);
      }
    }
  }, {
    key: 'finalize',
    value: function finalize() {
      var _this = this;

      if (this._isRfc822) {
        this._currentChild.finalize();
      } else {
        this._emitBody();
      }

      this.bodystructure = this.childNodes.reduce(function (agg, child) {
        return agg + '--' + _this._multipartBoundary + '\n' + child.bodystructure;
      }, this.header.join('\n') + '\n\n') + (this._multipartBoundary ? '--' + this._multipartBoundary + '--\n' : '');
    }

    /**
     * Processes a line in the HEADER state. It the line is empty, change state to BODY
     *
     * @param {String} line Entire input line as 'binary' string
     */

  }, {
    key: '_processHeaderLine',
    value: function _processHeaderLine(line) {
      if (!line) {
        this._parseHeaders();
        this.bodystructure += this.header.join('\n') + '\n\n';
        this._state = 'BODY';
        return;
      }

      if (line.match(/^\s/) && this.header.length) {
        this.header[this.header.length - 1] += '\n' + line;
      } else {
        this.header.push(line);
      }
    }

    /**
     * Joins folded header lines and calls Content-Type and Transfer-Encoding processors
     */

  }, {
    key: '_parseHeaders',
    value: function _parseHeaders() {
      for (var hasBinary = false, i = 0, len = this.header.length; i < len; i++) {
        var value = this.header[i].split(':');
        var key = (value.shift() || '').trim().toLowerCase();
        value = (value.join(':') || '').replace(/\n/g, '').trim();

        if (value.match(/[\u0080-\uFFFF]/)) {
          if (!this.charset) {
            hasBinary = true;
          }
          // use default charset at first and if the actual charset is resolved, the conversion is re-run
          value = (0, _emailjsMimeCodec.decode)((0, _emailjsMimeCodec.convert)(str2arr(value), this.charset || 'iso-8859-1'));
        }

        this.headers[key] = (this.headers[key] || []).concat([this._parseHeaderValue(key, value)]);

        if (!this.charset && key === 'content-type') {
          this.charset = this.headers[key][this.headers[key].length - 1].params.charset;
        }

        if (hasBinary && this.charset) {
          // reset values and start over once charset has been resolved and 8bit content has been found
          hasBinary = false;
          this.headers = {};
          i = -1; // next iteration has i == 0
        }
      }

      this._processContentType();
      this._processContentTransferEncoding();
    }

    /**
     * Parses single header value
     * @param {String} key Header key
     * @param {String} value Value for the key
     * @return {Object} parsed header
     */

  }, {
    key: '_parseHeaderValue',
    value: function _parseHeaderValue(key, value) {
      var parsedValue = void 0;
      var isAddress = false;

      switch (key) {
        case 'content-type':
        case 'content-transfer-encoding':
        case 'content-disposition':
        case 'dkim-signature':
          parsedValue = (0, _emailjsMimeCodec.parseHeaderValue)(value);
          break;
        case 'from':
        case 'sender':
        case 'to':
        case 'reply-to':
        case 'cc':
        case 'bcc':
        case 'abuse-reports-to':
        case 'errors-to':
        case 'return-path':
        case 'delivered-to':
          isAddress = true;
          parsedValue = {
            value: [].concat((0, _emailjsAddressparser2.default)(value) || [])
          };
          break;
        case 'date':
          parsedValue = {
            value: this._parseDate(value)
          };
          break;
        default:
          parsedValue = {
            value: value
          };
      }
      parsedValue.initial = value;

      this._decodeHeaderCharset(parsedValue, { isAddress: isAddress });

      return parsedValue;
    }

    /**
     * Checks if a date string can be parsed. Falls back replacing timezone
     * abbrevations with timezone values. Bogus timezones default to UTC.
     *
     * @param {String} str Date header
     * @returns {String} UTC date string if parsing succeeded, otherwise returns input value
     */

  }, {
    key: '_parseDate',
    value: function _parseDate() {
      var str = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';

      var date = new Date(str.trim().replace(/\b[a-z]+$/i, function (tz) {
        return _timezones2.default[tz.toUpperCase()] || '+0000';
      }));
      return date.toString() !== 'Invalid Date' ? date.toUTCString().replace(/GMT/, '+0000') : str;
    }
  }, {
    key: '_decodeHeaderCharset',
    value: function _decodeHeaderCharset(parsed) {
      var _this2 = this;

      var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          isAddress = _ref.isAddress;

      // decode default value
      if (typeof parsed.value === 'string') {
        parsed.value = (0, _emailjsMimeCodec.mimeWordsDecode)(parsed.value);
      }

      // decode possible params
      Object.keys(parsed.params || {}).forEach(function (key) {
        if (typeof parsed.params[key] === 'string') {
          parsed.params[key] = (0, _emailjsMimeCodec.mimeWordsDecode)(parsed.params[key]);
        }
      });

      // decode addresses
      if (isAddress && Array.isArray(parsed.value)) {
        parsed.value.forEach(function (addr) {
          if (addr.name) {
            addr.name = (0, _emailjsMimeCodec.mimeWordsDecode)(addr.name);
            if (Array.isArray(addr.group)) {
              _this2._decodeHeaderCharset({ value: addr.group }, { isAddress: true });
            }
          }
        });
      }

      return parsed;
    }

    /**
     * Parses Content-Type value and selects following actions.
     */

  }, {
    key: '_processContentType',
    value: function _processContentType() {
      var defaultValue = (0, _emailjsMimeCodec.parseHeaderValue)('text/plain');
      this.contentType = (0, _ramda.pathOr)(defaultValue, ['headers', 'content-type', '0'])(this);
      this.contentType.value = (this.contentType.value || '').toLowerCase().trim();
      this.contentType.type = this.contentType.value.split('/').shift() || 'text';

      if (this.contentType.params && this.contentType.params.charset && !this.charset) {
        this.charset = this.contentType.params.charset;
      }

      if (this.contentType.type === 'multipart' && this.contentType.params.boundary) {
        this.childNodes = [];
        this._isMultipart = this.contentType.value.split('/').pop() || 'mixed';
        this._multipartBoundary = this.contentType.params.boundary;
      }

      /**
       * For attachment (inline/regular) if charset is not defined and attachment is non-text/*,
       * then default charset to binary.
       * Refer to issue: https://github.com/emailjs/emailjs-mime-parser/issues/18
       */
      var defaultContentDispositionValue = (0, _emailjsMimeCodec.parseHeaderValue)('');
      var contentDisposition = (0, _ramda.pathOr)(defaultContentDispositionValue, ['headers', 'content-disposition', '0'])(this);
      var isAttachment = (contentDisposition.value || '').toLowerCase().trim() === 'attachment';
      var isInlineAttachment = (contentDisposition.value || '').toLowerCase().trim() === 'inline';
      if ((isAttachment || isInlineAttachment) && this.contentType.type !== 'text' && !this.charset) {
        this.charset = 'binary';
      }

      if (this.contentType.value === 'message/rfc822' && !isAttachment) {
        /**
         * Parse message/rfc822 only if the mime part is not marked with content-disposition: attachment,
         * otherwise treat it like a regular attachment
         */
        this._currentChild = new MimeNode(this);
        this.childNodes = [this._currentChild];
        this._isRfc822 = true;
      }
    }

    /**
     * Parses Content-Transfer-Encoding value to see if the body needs to be converted
     * before it can be emitted
     */

  }, {
    key: '_processContentTransferEncoding',
    value: function _processContentTransferEncoding() {
      var defaultValue = (0, _emailjsMimeCodec.parseHeaderValue)('7bit');
      this.contentTransferEncoding = (0, _ramda.pathOr)(defaultValue, ['headers', 'content-transfer-encoding', '0'])(this);
      this.contentTransferEncoding.value = (0, _ramda.pathOr)('', ['contentTransferEncoding', 'value'])(this).toLowerCase().trim();
    }

    /**
     * Processes a line in the BODY state. If this is a multipart or rfc822 node,
     * passes line value to child nodes.
     *
     * @param {String} line Entire input line as 'binary' string
     */

  }, {
    key: '_processBodyLine',
    value: function _processBodyLine(line) {
      this._lineCount++;

      if (this._isMultipart) {
        if (line === '--' + this._multipartBoundary) {
          this.bodystructure += line + '\n';
          if (this._currentChild) {
            this._currentChild.finalize();
          }
          this._currentChild = new MimeNode(this);
          this.childNodes.push(this._currentChild);
        } else if (line === '--' + this._multipartBoundary + '--') {
          this.bodystructure += line + '\n';
          if (this._currentChild) {
            this._currentChild.finalize();
          }
          this._currentChild = false;
        } else if (this._currentChild) {
          this._currentChild.writeLine(line);
        } else {
          // Ignore multipart preamble
        }
      } else if (this._isRfc822) {
        this._currentChild.writeLine(line);
      } else {
        switch (this.contentTransferEncoding.value) {
          case 'base64':
            {
              var curLine = this._lineRemainder + line.trim();

              if (curLine.length % 4) {
                this._lineRemainder = curLine.substr(-curLine.length % 4);
                curLine = curLine.substr(0, curLine.length - this._lineRemainder.length);
              } else {
                this._lineRemainder = '';
              }

              if (curLine.length) {
                this._bodyBuffer += (0, _emailjsMimeCodec.base64Decode)(curLine, this.charset);
              }

              break;
            }
          case 'quoted-printable':
            {
              var _curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line;
              var match = _curLine.match(/=[a-f0-9]{0,1}$/i);
              if (match) {
                this._lineRemainder = match[0];
                _curLine = _curLine.substr(0, _curLine.length - this._lineRemainder.length);
              } else {
                this._lineRemainder = '';
              }

              this._bodyBuffer += _curLine.replace(/=(\r?\n|$)/g, '').replace(/=([a-f0-9]{2})/ig, function (m, code) {
                return String.fromCharCode(parseInt(code, 16));
              });
              break;
            }
          case '7bit':
          case '8bit':
          default:
            this._bodyBuffer += (this._lineCount > 1 ? '\n' : '') + line;
            break;
        }
      }
    }

    /**
     * Emits a chunk of the body
    */

  }, {
    key: '_emitBody',
    value: function _emitBody() {
      if (this._isMultipart || !this._bodyBuffer) {
        return;
      }

      this._processFlowedText();
      this.content = str2arr(this._bodyBuffer);
      this._processHtmlText();
      this._bodyBuffer = '';
    }
  }, {
    key: '_processFlowedText',
    value: function _processFlowedText() {
      var isText = /^text\/(plain|html)$/i.test(this.contentType.value);
      var isFlowed = /^flowed$/i.test((0, _ramda.pathOr)('', ['contentType', 'params', 'format'])(this));
      if (!isText || !isFlowed) return;

      var delSp = /^yes$/i.test(this.contentType.params.delsp);
      this._bodyBuffer = this._bodyBuffer.split('\n').reduce(function (previousValue, currentValue) {
        // remove soft linebreaks after space symbols.
        // delsp adds spaces to text to be able to fold it.
        // these spaces can be removed once the text is unfolded
        var endsWithSpace = / $/.test(previousValue);
        var isBoundary = /(^|\n)-- $/.test(previousValue);
        return (delSp ? previousValue.replace(/[ ]+$/, '') : previousValue) + (endsWithSpace && !isBoundary ? '' : '\n') + currentValue;
      }).replace(/^ /gm, ''); // remove whitespace stuffing http://tools.ietf.org/html/rfc3676#section-4.4
    }
  }, {
    key: '_processHtmlText',
    value: function _processHtmlText() {
      var contentDisposition = this.headers['content-disposition'] && this.headers['content-disposition'][0] || (0, _emailjsMimeCodec.parseHeaderValue)('');
      var isHtml = /^text\/(plain|html)$/i.test(this.contentType.value);
      var isAttachment = /^attachment$/i.test(contentDisposition.value);
      if (isHtml && !isAttachment) {
        if (!this.charset && /^text\/html$/i.test(this.contentType.value)) {
          this.charset = this._detectHTMLCharset(this._bodyBuffer);
        }

        // decode "binary" string to an unicode string
        if (!/^utf[-_]?8$/i.test(this.charset)) {
          this.content = (0, _emailjsMimeCodec.convert)(str2arr(this._bodyBuffer), this.charset || 'iso-8859-1');
        }

        // override charset for text nodes
        this.charset = this.contentType.params.charset = 'utf-8';
      }
    }

    /**
     * Detect charset from a html file
     *
     * @param {String} html Input HTML
     * @returns {String} Charset if found or undefined
     */

  }, {
    key: '_detectHTMLCharset',
    value: function _detectHTMLCharset(html) {
      var charset = void 0,
          input = void 0;

      html = html.replace(/\r?\n|\r/g, ' ');
      var meta = html.match(/<meta\s+http-equiv=["'\s]*content-type[^>]*?>/i);
      if (meta) {
        input = meta[0];
      }

      if (input) {
        charset = input.match(/charset\s?=\s?([a-zA-Z\-_:0-9]*);?/);
        if (charset) {
          charset = (charset[1] || '').trim().toLowerCase();
        }
      }

      meta = html.match(/<meta\s+charset=["'\s]*([^"'<>/\s]+)/i);
      if (!charset && meta) {
        charset = (meta[1] || '').trim().toLowerCase();
      }

      return charset;
    }
  }]);

  return MimeNode;
}();

exports.default = MimeNode;


var str2arr = function str2arr(str) {
  return new TextEncoder().encode(str);
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9ub2RlLmpzIl0sIm5hbWVzIjpbIk1pbWVOb2RlIiwiaGVhZGVyIiwiaGVhZGVycyIsImJvZHlzdHJ1Y3R1cmUiLCJjaGlsZE5vZGVzIiwicmF3IiwiX3N0YXRlIiwiX2JvZHlCdWZmZXIiLCJfbGluZUNvdW50IiwiX2N1cnJlbnRDaGlsZCIsIl9saW5lUmVtYWluZGVyIiwiX2lzTXVsdGlwYXJ0IiwiX211bHRpcGFydEJvdW5kYXJ5IiwiX2lzUmZjODIyIiwibGluZSIsIl9wcm9jZXNzSGVhZGVyTGluZSIsIl9wcm9jZXNzQm9keUxpbmUiLCJmaW5hbGl6ZSIsIl9lbWl0Qm9keSIsInJlZHVjZSIsImFnZyIsImNoaWxkIiwiam9pbiIsIl9wYXJzZUhlYWRlcnMiLCJtYXRjaCIsImxlbmd0aCIsInB1c2giLCJoYXNCaW5hcnkiLCJpIiwibGVuIiwidmFsdWUiLCJzcGxpdCIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwicmVwbGFjZSIsImNoYXJzZXQiLCJzdHIyYXJyIiwiY29uY2F0IiwiX3BhcnNlSGVhZGVyVmFsdWUiLCJwYXJhbXMiLCJfcHJvY2Vzc0NvbnRlbnRUeXBlIiwiX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInBhcnNlZFZhbHVlIiwiaXNBZGRyZXNzIiwiX3BhcnNlRGF0ZSIsImluaXRpYWwiLCJfZGVjb2RlSGVhZGVyQ2hhcnNldCIsInN0ciIsImRhdGUiLCJEYXRlIiwidGltZXpvbmUiLCJ0eiIsInRvVXBwZXJDYXNlIiwidG9TdHJpbmciLCJ0b1VUQ1N0cmluZyIsInBhcnNlZCIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwiQXJyYXkiLCJpc0FycmF5IiwiYWRkciIsIm5hbWUiLCJncm91cCIsImRlZmF1bHRWYWx1ZSIsImNvbnRlbnRUeXBlIiwidHlwZSIsImJvdW5kYXJ5IiwicG9wIiwiZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlIiwiY29udGVudERpc3Bvc2l0aW9uIiwiaXNBdHRhY2htZW50IiwiaXNJbmxpbmVBdHRhY2htZW50IiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ3cml0ZUxpbmUiLCJjdXJMaW5lIiwic3Vic3RyIiwibSIsImNvZGUiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJwYXJzZUludCIsIl9wcm9jZXNzRmxvd2VkVGV4dCIsImNvbnRlbnQiLCJfcHJvY2Vzc0h0bWxUZXh0IiwiaXNUZXh0IiwidGVzdCIsImlzRmxvd2VkIiwiZGVsU3AiLCJkZWxzcCIsInByZXZpb3VzVmFsdWUiLCJjdXJyZW50VmFsdWUiLCJlbmRzV2l0aFNwYWNlIiwiaXNCb3VuZGFyeSIsImlzSHRtbCIsIl9kZXRlY3RIVE1MQ2hhcnNldCIsImh0bWwiLCJpbnB1dCIsIm1ldGEiLCJUZXh0RW5jb2RlciIsImVuY29kZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQTs7QUFDQTs7OztBQUNBOztBQUNBOzs7Ozs7OztJQUVxQkEsUTtBQUNuQixzQkFBZTtBQUFBOztBQUNiLFNBQUtDLE1BQUwsR0FBYyxFQUFkLENBRGEsQ0FDSTtBQUNqQixTQUFLQyxPQUFMLEdBQWUsRUFBZixDQUZhLENBRUs7QUFDbEIsU0FBS0MsYUFBTCxHQUFxQixFQUFyQjtBQUNBLFNBQUtDLFVBQUwsR0FBa0IsRUFBbEIsQ0FKYSxDQUlRO0FBQ3JCLFNBQUtDLEdBQUwsR0FBVyxFQUFYLENBTGEsQ0FLQzs7QUFFZCxTQUFLQyxNQUFMLEdBQWMsUUFBZCxDQVBhLENBT1U7QUFDdkIsU0FBS0MsV0FBTCxHQUFtQixFQUFuQixDQVJhLENBUVM7QUFDdEIsU0FBS0MsVUFBTCxHQUFrQixDQUFsQixDQVRhLENBU087QUFDcEIsU0FBS0MsYUFBTCxHQUFxQixLQUFyQixDQVZhLENBVWM7QUFDM0IsU0FBS0MsY0FBTCxHQUFzQixFQUF0QixDQVhhLENBV1k7QUFDekIsU0FBS0MsWUFBTCxHQUFvQixLQUFwQixDQVphLENBWWE7QUFDMUIsU0FBS0Msa0JBQUwsR0FBMEIsS0FBMUIsQ0FiYSxDQWFtQjtBQUNo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QUEsU0FBTyxJQUFJK0QsV0FBSixHQUFrQkMsTUFBbEIsQ0FBeUJyRCxHQUF6QixDQUFQO0FBQUEsQ0FBaEIiLCJmaWxlIjoibm9kZS5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhdGhPciB9IGZyb20gJ3JhbWRhJ1xuaW1wb3J0IHRpbWV6b25lIGZyb20gJy4vdGltZXpvbmVzJ1xuaW1wb3J0IHsgZGVjb2RlLCBiYXNlNjREZWNvZGUsIGNvbnZlcnQsIHBhcnNlSGVhZGVyVmFsdWUsIG1pbWVXb3Jkc0RlY29kZSB9IGZyb20gJ2VtYWlsanMtbWltZS1jb2RlYydcbmltcG9ydCBwYXJzZUFkZHJlc3MgZnJvbSAnZW1haWxqcy1hZGRyZXNzcGFyc2VyJ1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNaW1lTm9kZSB7XG4gIGNvbnN0cnVjdG9yICgpIHtcbiAgICB0aGlzLmhlYWRlciA9IFtdIC8vIEFuIGFycmF5IG9mIHVuZm9sZGVkIGhlYWRlciBsaW5lc1xuICAgIHRoaXMuaGVhZGVycyA9IHt9IC8vIEFuIG9iamVjdCB0aGF0IGhvbGRzIGhlYWRlciBrZXk9dmFsdWUgcGFpcnNcbiAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgPSAnJ1xuICAgIHRoaXMuY2hpbGROb2RlcyA9IFtdIC8vIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgbWVzc2FnZS9yZmM4MjIgbWltZSBwYXJ0LCB0aGUgdmFsdWUgd2lsbCBiZSBjb252ZXJ0ZWQgdG8gYXJyYXkgYW5kIGhvbGQgYWxsIGNoaWxkIG5vZGVzIGZvciB0aGlzIG5vZGVcbiAgICB0aGlzLnJhdyA9ICcnIC8vIFN0b3JlcyB0aGUgcmF3IGNvbnRlbnQgb2YgdGhpcyBub2RlXG5cbiAgICB0aGlzLl9zdGF0ZSA9ICdIRUFERVInIC8vIEN1cnJlbnQgc3RhdGUsIGFsd2F5cyBzdGFydHMgb3V0IHdpdGggSEVBREVSXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnIC8vIEJvZHkgYnVmZmVyXG4gICAgdGhpcy5fbGluZUNvdW50ID0gMCAvLyBMaW5lIGNvdW50ZXIgYm9yIHRoZSBib2R5IHBhcnRcbiAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBmYWxzZSAvLyBBY3RpdmUgY2hpbGQgbm9kZSAoaWYgYXZhaWxhYmxlKVxuICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJyAvLyBSZW1haW5kZXIgc3RyaW5nIHdoZW4gZGVhbGluZyB3aXRoIGJhc2U2NCBhbmQgcXAgdmFsdWVzXG4gICAgdGhpcy5faXNNdWx0aXBhcnQgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSBmYWxzZSAvLyBTdG9yZXMgYm91bmRhcnkgdmFsdWUgZm9yIGN1cnJlbnQgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9pc1JmYzgyMiA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbWVzc2FnZS9yZmM4MjIgbm9kZVxuICB9XG5cbiAgd3JpdGVMaW5lIChsaW5lKSB7XG4gICAgdGhpcy5yYXcgKz0gKHRoaXMucmF3ID8gJ1xcbicgOiAnJykgKyBsaW5lXG5cbiAgICBpZiAodGhpcy5fc3RhdGUgPT09ICdIRUFERVInKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzSGVhZGVyTGluZShsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5fc3RhdGUgPT09ICdCT0RZJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0JvZHlMaW5lKGxpbmUpXG4gICAgfVxuICB9XG5cbiAgZmluYWxpemUgKCkge1xuICAgIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZW1pdEJvZHkoKVxuICAgIH1cblxuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9IHRoaXMuY2hpbGROb2Rlc1xuICAgIC5yZWR1Y2UoKGFnZywgY2hpbGQpID0+IGFnZyArICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICdcXG4nICsgY2hpbGQuYm9keXN0cnVjdHVyZSwgdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJykgK1xuICAgICh0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA/ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICctLVxcbicgOiAnJylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgYSBsaW5lIGluIHRoZSBIRUFERVIgc3RhdGUuIEl0IHRoZSBsaW5lIGlzIGVtcHR5LCBjaGFuZ2Ugc3RhdGUgdG8gQk9EWVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICovXG4gIF9wcm9jZXNzSGVhZGVyTGluZSAobGluZSkge1xuICAgIGlmICghbGluZSkge1xuICAgICAgdGhpcy5fcGFyc2VIZWFkZXJzKClcbiAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSB0aGlzLmhlYWRlci5qb2luKCdcXG4nKSArICdcXG5cXG4nXG4gICAgICB0aGlzLl9zdGF0ZSA9ICdCT0RZJ1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGxpbmUubWF0Y2goL15cXHMvKSAmJiB0aGlzLmhlYWRlci5sZW5ndGgpIHtcbiAgICAgIHRoaXMuaGVhZGVyW3RoaXMuaGVhZGVyLmxlbmd0aCAtIDFdICs9ICdcXG4nICsgbGluZVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmhlYWRlci5wdXNoKGxpbmUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEpvaW5zIGZvbGRlZCBoZWFkZXIgbGluZXMgYW5kIGNhbGxzIENvbnRlbnQtVHlwZSBhbmQgVHJhbnNmZXItRW5jb2RpbmcgcHJvY2Vzc29yc1xuICAgKi9cbiAgX3BhcnNlSGVhZGVycyAoKSB7XG4gICAgZm9yIChsZXQgaGFzQmluYXJ5ID0gZmFsc2UsIGkgPSAwLCBsZW4gPSB0aGlzLmhlYWRlci5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgbGV0IHZhbHVlID0gdGhpcy5oZWFkZXJbaV0uc3BsaXQoJzonKVxuICAgICAgY29uc3Qga2V5ID0gKHZhbHVlLnNoaWZ0KCkgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgICB2YWx1ZSA9ICh2YWx1ZS5qb2luKCc6JykgfHwgJycpLnJlcGxhY2UoL1xcbi9nLCAnJykudHJpbSgpXG5cbiAgICAgIGlmICh2YWx1ZS5tYXRjaCgvW1xcdTAwODAtXFx1RkZGRl0vKSkge1xuICAgICAgICBpZiAoIXRoaXMuY2hhcnNldCkge1xuICAgICAgICAgIGhhc0JpbmFyeSA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICAvLyB1c2UgZGVmYXVsdCBjaGFyc2V0IGF0IGZpcnN0IGFuZCBpZiB0aGUgYWN0dWFsIGNoYXJzZXQgaXMgcmVzb2x2ZWQsIHRoZSBjb252ZXJzaW9uIGlzIHJlLXJ1blxuICAgICAgICB2YWx1ZSA9IGRlY29kZShjb252ZXJ0KHN0cjJhcnIodmFsdWUpLCB0aGlzLmNoYXJzZXQgfHwgJ2lzby04ODU5LTEnKSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5oZWFkZXJzW2tleV0gPSAodGhpcy5oZWFkZXJzW2tleV0gfHwgW10pLmNvbmNhdChbdGhpcy5fcGFyc2VIZWFkZXJWYWx1ZShrZXksIHZhbHVlKV0pXG5cbiAgICAgIGlmICghdGhpcy5jaGFyc2V0ICYmIGtleSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5oZWFkZXJzW2tleV1bdGhpcy5oZWFkZXJzW2tleV0ubGVuZ3RoIC0gMV0ucGFyYW1zLmNoYXJzZXRcbiAgICAgIH1cblxuICAgICAgaWYgKGhhc0JpbmFyeSAmJiB0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgLy8gcmVzZXQgdmFsdWVzIGFuZCBzdGFydCBvdmVyIG9uY2UgY2hhcnNldCBoYXMgYmVlbiByZXNvbHZlZCBhbmQgOGJpdCBjb250ZW50IGhhcyBiZWVuIGZvdW5kXG4gICAgICAgIGhhc0JpbmFyeSA9IGZhbHNlXG4gICAgICAgIHRoaXMuaGVhZGVycyA9IHt9XG4gICAgICAgIGkgPSAtMSAvLyBuZXh0IGl0ZXJhdGlvbiBoYXMgaSA9PSAwXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUeXBlKClcbiAgICB0aGlzLl9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBzaW5nbGUgaGVhZGVyIHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkgSGVhZGVyIGtleVxuICAgKiBAcGFyYW0ge1N0cmluZ30gdmFsdWUgVmFsdWUgZm9yIHRoZSBrZXlcbiAgICogQHJldHVybiB7T2JqZWN0fSBwYXJzZWQgaGVhZGVyXG4gICAqL1xuICBfcGFyc2VIZWFkZXJWYWx1ZSAoa2V5LCB2YWx1ZSkge1xuICAgIGxldCBwYXJzZWRWYWx1ZVxuICAgIGxldCBpc0FkZHJlc3MgPSBmYWxzZVxuXG4gICAgc3dpdGNoIChrZXkpIHtcbiAgICAgIGNhc2UgJ2NvbnRlbnQtdHlwZSc6XG4gICAgICBjYXNlICdjb250ZW50LXRyYW5zZmVyLWVuY29kaW5nJzpcbiAgICAgIGNhc2UgJ2NvbnRlbnQtZGlzcG9zaXRpb24nOlxuICAgICAgY2FzZSAnZGtpbS1zaWduYXR1cmUnOlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUodmFsdWUpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdmcm9tJzpcbiAgICAgIGNhc2UgJ3NlbmRlcic6XG4gICAgICBjYXNlICd0byc6XG4gICAgICBjYXNlICdyZXBseS10byc6XG4gICAgICBjYXNlICdjYyc6XG4gICAgICBjYXNlICdiY2MnOlxuICAgICAgY2FzZSAnYWJ1c2UtcmVwb3J0cy10byc6XG4gICAgICBjYXNlICdlcnJvcnMtdG8nOlxuICAgICAgY2FzZSAncmV0dXJuLXBhdGgnOlxuICAgICAgY2FzZSAnZGVsaXZlcmVkLXRvJzpcbiAgICAgICAgaXNBZGRyZXNzID0gdHJ1ZVxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogW10uY29uY2F0KHBhcnNlQWRkcmVzcyh2YWx1ZSkgfHwgW10pXG4gICAgICAgIH1cbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogdGhpcy5fcGFyc2VEYXRlKHZhbHVlKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogdmFsdWVcbiAgICAgICAgfVxuICAgIH1cbiAgICBwYXJzZWRWYWx1ZS5pbml0aWFsID0gdmFsdWVcblxuICAgIHRoaXMuX2RlY29kZUhlYWRlckNoYXJzZXQocGFyc2VkVmFsdWUsIHsgaXNBZGRyZXNzIH0pXG5cbiAgICByZXR1cm4gcGFyc2VkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBkYXRlIHN0cmluZyBjYW4gYmUgcGFyc2VkLiBGYWxscyBiYWNrIHJlcGxhY2luZyB0aW1lem9uZVxuICAgKiBhYmJyZXZhdGlvbnMgd2l0aCB0aW1lem9uZSB2YWx1ZXMuIEJvZ3VzIHRpbWV6b25lcyBkZWZhdWx0IHRvIFVUQy5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IHN0ciBEYXRlIGhlYWRlclxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBVVEMgZGF0ZSBzdHJpbmcgaWYgcGFyc2luZyBzdWNjZWVkZWQsIG90aGVyd2lzZSByZXR1cm5zIGlucHV0IHZhbHVlXG4gICAqL1xuICBfcGFyc2VEYXRlIChzdHIgPSAnJykge1xuICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZShzdHIudHJpbSgpLnJlcGxhY2UoL1xcYlthLXpdKyQvaSwgdHogPT4gdGltZXpvbmVbdHoudG9VcHBlckNhc2UoKV0gfHwgJyswMDAwJykpXG4gICAgcmV0dXJuIChkYXRlLnRvU3RyaW5nKCkgIT09ICdJbnZhbGlkIERhdGUnKSA/IGRhdGUudG9VVENTdHJpbmcoKS5yZXBsYWNlKC9HTVQvLCAnKzAwMDAnKSA6IHN0clxuICB9XG5cbiAgX2RlY29kZUhlYWRlckNoYXJzZXQgKHBhcnNlZCwgeyBpc0FkZHJlc3MgfSA9IHt9KSB7XG4gICAgLy8gZGVjb2RlIGRlZmF1bHQgdmFsdWVcbiAgICBpZiAodHlwZW9mIHBhcnNlZC52YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHBhcnNlZC52YWx1ZSA9IG1pbWVXb3Jkc0RlY29kZShwYXJzZWQudmFsdWUpXG4gICAgfVxuXG4gICAgLy8gZGVjb2RlIHBvc3NpYmxlIHBhcmFtc1xuICAgIE9iamVjdC5rZXlzKHBhcnNlZC5wYXJhbXMgfHwge30pLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgICAgaWYgKHR5cGVvZiBwYXJzZWQucGFyYW1zW2tleV0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHBhcnNlZC5wYXJhbXNba2V5XSA9IG1pbWVXb3Jkc0RlY29kZShwYXJzZWQucGFyYW1zW2tleV0pXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIGRlY29kZSBhZGRyZXNzZXNcbiAgICBpZiAoaXNBZGRyZXNzICYmIEFycmF5LmlzQXJyYXkocGFyc2VkLnZhbHVlKSkge1xuICAgICAgcGFyc2VkLnZhbHVlLmZvckVhY2goYWRkciA9PiB7XG4gICAgICAgIGlmIChhZGRyLm5hbWUpIHtcbiAgICAgICAgICBhZGRyLm5hbWUgPSBtaW1lV29yZHNEZWNvZGUoYWRkci5uYW1lKVxuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGFkZHIuZ3JvdXApKSB7XG4gICAgICAgICAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHsgdmFsdWU6IGFkZHIuZ3JvdXAgfSwgeyBpc0FkZHJlc3M6IHRydWUgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcnNlZFxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBDb250ZW50LVR5cGUgdmFsdWUgYW5kIHNlbGVjdHMgZm9sbG93aW5nIGFjdGlvbnMuXG4gICAqL1xuICBfcHJvY2Vzc0NvbnRlbnRUeXBlICgpIHtcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCd0ZXh0L3BsYWluJylcbiAgICB0aGlzLmNvbnRlbnRUeXBlID0gcGF0aE9yKGRlZmF1bHRWYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtdHlwZScsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHlwZS52YWx1ZSA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICAgIHRoaXMuY29udGVudFR5cGUudHlwZSA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlLnNwbGl0KCcvJykuc2hpZnQoKSB8fCAndGV4dCcpXG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS5wYXJhbXMgJiYgdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldCAmJiAhdGhpcy5jaGFyc2V0KSB7XG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudHlwZSA9PT0gJ211bHRpcGFydCcgJiYgdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuYm91bmRhcnkpIHtcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFtdXG4gICAgICB0aGlzLl9pc011bHRpcGFydCA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlLnNwbGl0KCcvJykucG9wKCkgfHwgJ21peGVkJylcbiAgICAgIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuYm91bmRhcnlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBGb3IgYXR0YWNobWVudCAoaW5saW5lL3JlZ3VsYXIpIGlmIGNoYXJzZXQgaXMgbm90IGRlZmluZWQgYW5kIGF0dGFjaG1lbnQgaXMgbm9uLXRleHQvKixcbiAgICAgKiB0aGVuIGRlZmF1bHQgY2hhcnNldCB0byBiaW5hcnkuXG4gICAgICogUmVmZXIgdG8gaXNzdWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9lbWFpbGpzL2VtYWlsanMtbWltZS1wYXJzZXIvaXNzdWVzLzE4XG4gICAgICovXG4gICAgY29uc3QgZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgnJylcbiAgICBjb25zdCBjb250ZW50RGlzcG9zaXRpb24gPSBwYXRoT3IoZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC1kaXNwb3NpdGlvbicsICcwJ10pKHRoaXMpXG4gICAgY29uc3QgaXNBdHRhY2htZW50ID0gKGNvbnRlbnREaXNwb3NpdGlvbi52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKCkgPT09ICdhdHRhY2htZW50J1xuICAgIGNvbnN0IGlzSW5saW5lQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnaW5saW5lJ1xuICAgIGlmICgoaXNBdHRhY2htZW50IHx8IGlzSW5saW5lQXR0YWNobWVudCkgJiYgdGhpcy5jb250ZW50VHlwZS50eXBlICE9PSAndGV4dCcgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gJ2JpbmFyeSdcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS52YWx1ZSA9PT0gJ21lc3NhZ2UvcmZjODIyJyAmJiAhaXNBdHRhY2htZW50KSB7XG4gICAgICAvKipcbiAgICAgICAqIFBhcnNlIG1lc3NhZ2UvcmZjODIyIG9ubHkgaWYgdGhlIG1pbWUgcGFydCBpcyBub3QgbWFya2VkIHdpdGggY29udGVudC1kaXNwb3NpdGlvbjogYXR0YWNobWVudCxcbiAgICAgICAqIG90aGVyd2lzZSB0cmVhdCBpdCBsaWtlIGEgcmVndWxhciBhdHRhY2htZW50XG4gICAgICAgKi9cbiAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IG5ldyBNaW1lTm9kZSh0aGlzKVxuICAgICAgdGhpcy5jaGlsZE5vZGVzID0gW3RoaXMuX2N1cnJlbnRDaGlsZF1cbiAgICAgIHRoaXMuX2lzUmZjODIyID0gdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UcmFuc2Zlci1FbmNvZGluZyB2YWx1ZSB0byBzZWUgaWYgdGhlIGJvZHkgbmVlZHMgdG8gYmUgY29udmVydGVkXG4gICAqIGJlZm9yZSBpdCBjYW4gYmUgZW1pdHRlZFxuICAgKi9cbiAgX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgnN2JpdCcpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZyA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXRyYW5zZmVyLWVuY29kaW5nJywgJzAnXSkodGhpcylcbiAgICB0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlID0gcGF0aE9yKCcnLCBbJ2NvbnRlbnRUcmFuc2ZlckVuY29kaW5nJywgJ3ZhbHVlJ10pKHRoaXMpLnRvTG93ZXJDYXNlKCkudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgQk9EWSBzdGF0ZS4gSWYgdGhpcyBpcyBhIG11bHRpcGFydCBvciByZmM4MjIgbm9kZSxcbiAgICogcGFzc2VzIGxpbmUgdmFsdWUgdG8gY2hpbGQgbm9kZXMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBsaW5lIEVudGlyZSBpbnB1dCBsaW5lIGFzICdiaW5hcnknIHN0cmluZ1xuICAgKi9cbiAgX3Byb2Nlc3NCb2R5TGluZSAobGluZSkge1xuICAgIHRoaXMuX2xpbmVDb3VudCsrXG5cbiAgICBpZiAodGhpcy5faXNNdWx0aXBhcnQpIHtcbiAgICAgIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkpIHtcbiAgICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IGxpbmUgKyAnXFxuJ1xuICAgICAgICBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcylcbiAgICAgICAgdGhpcy5jaGlsZE5vZGVzLnB1c2godGhpcy5fY3VycmVudENoaWxkKVxuICAgICAgfSBlbHNlIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS0nKSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2VcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC53cml0ZUxpbmUobGluZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElnbm9yZSBtdWx0aXBhcnQgcHJlYW1ibGVcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUpXG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSkge1xuICAgICAgICBjYXNlICdiYXNlNjQnOiB7XG4gICAgICAgICAgbGV0IGN1ckxpbmUgPSB0aGlzLl9saW5lUmVtYWluZGVyICsgbGluZS50cmltKClcblxuICAgICAgICAgIGlmIChjdXJMaW5lLmxlbmd0aCAlIDQpIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSBjdXJMaW5lLnN1YnN0cigtY3VyTGluZS5sZW5ndGggJSA0KVxuICAgICAgICAgICAgY3VyTGluZSA9IGN1ckxpbmUuc3Vic3RyKDAsIGN1ckxpbmUubGVuZ3RoIC0gdGhpcy5fbGluZVJlbWFpbmRlci5sZW5ndGgpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJ1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChjdXJMaW5lLmxlbmd0aCkge1xuICAgICAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciArPSBiYXNlNjREZWNvZGUoY3VyTGluZSwgdGhpcy5jaGFyc2V0KVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6IHtcbiAgICAgICAgICBsZXQgY3VyTGluZSA9IHRoaXMuX2xpbmVSZW1haW5kZXIgKyAodGhpcy5fbGluZUNvdW50ID4gMSA/ICdcXG4nIDogJycpICsgbGluZVxuICAgICAgICAgIGNvbnN0IG1hdGNoID0gY3VyTGluZS5tYXRjaCgvPVthLWYwLTldezAsMX0kL2kpXG4gICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gbWF0Y2hbMF1cbiAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGN1ckxpbmUucmVwbGFjZSgvPShcXHI/XFxufCQpL2csICcnKS5yZXBsYWNlKC89KFthLWYwLTldezJ9KS9pZywgZnVuY3Rpb24gKG0sIGNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKHBhcnNlSW50KGNvZGUsIDE2KSlcbiAgICAgICAgICB9KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnN2JpdCc6XG4gICAgICAgIGNhc2UgJzhiaXQnOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gKHRoaXMuX2xpbmVDb3VudCA+IDEgPyAnXFxuJyA6ICcnKSArIGxpbmVcbiAgICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBhIGNodW5rIG9mIHRoZSBib2R5XG4gICovXG4gIF9lbWl0Qm9keSAoKSB7XG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0IHx8ICF0aGlzLl9ib2R5QnVmZmVyKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9wcm9jZXNzRmxvd2VkVGV4dCgpXG4gICAgdGhpcy5jb250ZW50ID0gc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKVxuICAgIHRoaXMuX3Byb2Nlc3NIdG1sVGV4dCgpXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnXG4gIH1cblxuICBfcHJvY2Vzc0Zsb3dlZFRleHQgKCkge1xuICAgIGNvbnN0IGlzVGV4dCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNGbG93ZWQgPSAvXmZsb3dlZCQvaS50ZXN0KHBhdGhPcignJywgWydjb250ZW50VHlwZScsICdwYXJhbXMnLCAnZm9ybWF0J10pKHRoaXMpKVxuICAgIGlmICghaXNUZXh0IHx8ICFpc0Zsb3dlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWxTcCA9IC9eeWVzJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS5wYXJhbXMuZGVsc3ApXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9IHRoaXMuX2JvZHlCdWZmZXIuc3BsaXQoJ1xcbicpXG4gICAgICAucmVkdWNlKGZ1bmN0aW9uIChwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWUpIHtcbiAgICAgICAgLy8gcmVtb3ZlIHNvZnQgbGluZWJyZWFrcyBhZnRlciBzcGFjZSBzeW1ib2xzLlxuICAgICAgICAvLyBkZWxzcCBhZGRzIHNwYWNlcyB0byB0ZXh0IHRvIGJlIGFibGUgdG8gZm9sZCBpdC5cbiAgICAgICAgLy8gdGhlc2Ugc3BhY2VzIGNhbiBiZSByZW1vdmVkIG9uY2UgdGhlIHRleHQgaXMgdW5mb2xkZWRcbiAgICAgICAgY29uc3QgZW5kc1dpdGhTcGFjZSA9IC8gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICBjb25zdCBpc0JvdW5kYXJ5ID0gLyhefFxcbiktLSAkLy50ZXN0KHByZXZpb3VzVmFsdWUpXG4gICAgICAgIHJldHVybiAoZGVsU3AgPyBwcmV2aW91c1ZhbHVlLnJlcGxhY2UoL1sgXSskLywgJycpIDogcHJldmlvdXNWYWx1ZSkgKyAoKGVuZHNXaXRoU3BhY2UgJiYgIWlzQm91bmRhcnkpID8gJycgOiAnXFxuJykgKyBjdXJyZW50VmFsdWVcbiAgICAgIH0pXG4gICAgICAucmVwbGFjZSgvXiAvZ20sICcnKSAvLyByZW1vdmUgd2hpdGVzcGFjZSBzdHVmZmluZyBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNjc2I3NlY3Rpb24tNC40XG4gIH1cblxuICBfcHJvY2Vzc0h0bWxUZXh0ICgpIHtcbiAgICBjb25zdCBjb250ZW50RGlzcG9zaXRpb24gPSAodGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgdGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ11bMF0pIHx8IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgaXNIdG1sID0gL150ZXh0XFwvKHBsYWlufGh0bWwpJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSlcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAvXmF0dGFjaG1lbnQkL2kudGVzdChjb250ZW50RGlzcG9zaXRpb24udmFsdWUpXG4gICAgaWYgKGlzSHRtbCAmJiAhaXNBdHRhY2htZW50KSB7XG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiAvXnRleHRcXC9odG1sJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSkpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5fZGV0ZWN0SFRNTENoYXJzZXQodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gZGVjb2RlIFwiYmluYXJ5XCIgc3RyaW5nIHRvIGFuIHVuaWNvZGUgc3RyaW5nXG4gICAgICBpZiAoIS9edXRmWy1fXT84JC9pLnRlc3QodGhpcy5jaGFyc2V0KSkge1xuICAgICAgICB0aGlzLmNvbnRlbnQgPSBjb252ZXJ0KHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlciksIHRoaXMuY2hhcnNldCB8fCAnaXNvLTg4NTktMScpXG4gICAgICB9XG5cbiAgICAgIC8vIG92ZXJyaWRlIGNoYXJzZXQgZm9yIHRleHQgbm9kZXNcbiAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgPSAndXRmLTgnXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERldGVjdCBjaGFyc2V0IGZyb20gYSBodG1sIGZpbGVcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGh0bWwgSW5wdXQgSFRNTFxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBDaGFyc2V0IGlmIGZvdW5kIG9yIHVuZGVmaW5lZFxuICAgKi9cbiAgX2RldGVjdEhUTUxDaGFyc2V0IChodG1sKSB7XG4gICAgbGV0IGNoYXJzZXQsIGlucHV0XG5cbiAgICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXHI/XFxufFxcci9nLCAnICcpXG4gICAgbGV0IG1ldGEgPSBodG1sLm1hdGNoKC88bWV0YVxccytodHRwLWVxdWl2PVtcIidcXHNdKmNvbnRlbnQtdHlwZVtePl0qPz4vaSlcbiAgICBpZiAobWV0YSkge1xuICAgICAgaW5wdXQgPSBtZXRhWzBdXG4gICAgfVxuXG4gICAgaWYgKGlucHV0KSB7XG4gICAgICBjaGFyc2V0ID0gaW5wdXQubWF0Y2goL2NoYXJzZXRcXHM/PVxccz8oW2EtekEtWlxcLV86MC05XSopOz8vKVxuICAgICAgaWYgKGNoYXJzZXQpIHtcbiAgICAgICAgY2hhcnNldCA9IChjaGFyc2V0WzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgfVxuICAgIH1cblxuICAgIG1ldGEgPSBodG1sLm1hdGNoKC88bWV0YVxccytjaGFyc2V0PVtcIidcXHNdKihbXlwiJzw+L1xcc10rKS9pKVxuICAgIGlmICghY2hhcnNldCAmJiBtZXRhKSB7XG4gICAgICBjaGFyc2V0ID0gKG1ldGFbMV0gfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYXJzZXRcbiAgfVxufVxuXG5jb25zdCBzdHIyYXJyID0gc3RyID0+IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzdHIpXG4iXX0=