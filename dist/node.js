'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ramda = require('ramda');

var _timezones = require('./timezones');

var _timezones2 = _interopRequireDefault(_timezones);

var _emailjsMimeCodec = require('emailjs-mime-codec');

var _textEncoding = require('text-encoding');

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
  return new _textEncoding.TextEncoder().encode(str);
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9ub2RlLmpzIl0sIm5hbWVzIjpbIk1pbWVOb2RlIiwiaGVhZGVyIiwiaGVhZGVycyIsImJvZHlzdHJ1Y3R1cmUiLCJjaGlsZE5vZGVzIiwicmF3IiwiX3N0YXRlIiwiX2JvZHlCdWZmZXIiLCJfbGluZUNvdW50IiwiX2N1cnJlbnRDaGlsZCIsIl9saW5lUmVtYWluZGVyIiwiX2lzTXVsdGlwYXJ0IiwiX211bHRpcGFydEJvdW5kYXJ5IiwiX2lzUmZjODIyIiwibGluZSIsIl9wcm9jZXNzSGVhZGVyTGluZSIsIl9wcm9jZXNzQm9keUxpbmUiLCJmaW5hbGl6ZSIsIl9lbWl0Qm9keSIsInJlZHVjZSIsImFnZyIsImNoaWxkIiwiam9pbiIsIl9wYXJzZUhlYWRlcnMiLCJtYXRjaCIsImxlbmd0aCIsInB1c2giLCJoYXNCaW5hcnkiLCJpIiwibGVuIiwidmFsdWUiLCJzcGxpdCIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwicmVwbGFjZSIsImNoYXJzZXQiLCJzdHIyYXJyIiwiY29uY2F0IiwiX3BhcnNlSGVhZGVyVmFsdWUiLCJwYXJhbXMiLCJfcHJvY2Vzc0NvbnRlbnRUeXBlIiwiX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInBhcnNlZFZhbHVlIiwiaXNBZGRyZXNzIiwiX3BhcnNlRGF0ZSIsImluaXRpYWwiLCJfZGVjb2RlSGVhZGVyQ2hhcnNldCIsInN0ciIsImRhdGUiLCJEYXRlIiwidGltZXpvbmUiLCJ0eiIsInRvVXBwZXJDYXNlIiwidG9TdHJpbmciLCJ0b1VUQ1N0cmluZyIsInBhcnNlZCIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwiQXJyYXkiLCJpc0FycmF5IiwiYWRkciIsIm5hbWUiLCJncm91cCIsImRlZmF1bHRWYWx1ZSIsImNvbnRlbnRUeXBlIiwidHlwZSIsImJvdW5kYXJ5IiwicG9wIiwiZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlIiwiY29udGVudERpc3Bvc2l0aW9uIiwiaXNBdHRhY2htZW50IiwiaXNJbmxpbmVBdHRhY2htZW50IiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ3cml0ZUxpbmUiLCJjdXJMaW5lIiwic3Vic3RyIiwibSIsImNvZGUiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJwYXJzZUludCIsIl9wcm9jZXNzRmxvd2VkVGV4dCIsImNvbnRlbnQiLCJfcHJvY2Vzc0h0bWxUZXh0IiwiaXNUZXh0IiwidGVzdCIsImlzRmxvd2VkIiwiZGVsU3AiLCJkZWxzcCIsInByZXZpb3VzVmFsdWUiLCJjdXJyZW50VmFsdWUiLCJlbmRzV2l0aFNwYWNlIiwiaXNCb3VuZGFyeSIsImlzSHRtbCIsIl9kZXRlY3RIVE1MQ2hhcnNldCIsImh0bWwiLCJpbnB1dCIsIm1ldGEiLCJUZXh0RW5jb2RlciIsImVuY29kZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQTs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOzs7Ozs7OztJQUVxQkEsUTtBQUNuQixzQkFBZTtBQUFBOztBQUNiLFNBQUtDLE1BQUwsR0FBYyxFQUFkLENBRGEsQ0FDSTtBQUNqQixTQUFLQyxPQUFMLEdBQWUsRUFBZixDQUZhLENBRUs7QUFDbEIsU0FBS0MsYUFBTCxHQUFxQixFQUFyQjtBQUNBLFNBQUtDLFVBQUwsR0FBa0IsRUFBbEIsQ0FKYSxDQUlRO0FBQ3JCLFNBQUtDLEdBQUwsR0FBVyxFQUFYLENBTGEsQ0FLQzs7QUFFZCxTQUFLQyxNQUFMLEdBQWMsUUFBZCxDQVBhLENBT1U7QUFDdkIsU0FBS0MsV0FBTCxHQUFtQixFQUFuQixDQVJhLENBUVM7QUFDdEIsU0FBS0MsVUFBTCxHQUFrQixDQUFsQixDQVRhLENBU087QUFDcEIsU0FBS0MsYUFBTCxHQUFxQixLQUFyQixDQVZhLENBVWM7QUFDM0IsU0FBS0MsY0FBTCxHQUFzQixFQUF0QixDQVhhLENBV1k7QUFDekIsU0FBS0MsWUFBTCxHQUFvQixLQUFwQixDQVphLENBWWE7QUFDMUIsU0FBS0Msa0JBQUwsR0FBMEIsS0FBMUIsQ0FiYSxDQWFt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QUFVO0FBQUEsU0FBTyxJQUFJK0QseUJBQUosR0FBa0JDLE1BQWxCLENBQXlCckQsR0FBekIsQ0FBUDtBQUFBLENBQWhCIiwiZmlsZSI6Im5vZGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBwYXRoT3IgfSBmcm9tICdyYW1kYSdcbmltcG9ydCB0aW1lem9uZSBmcm9tICcuL3RpbWV6b25lcydcbmltcG9ydCB7IGRlY29kZSwgYmFzZTY0RGVjb2RlLCBjb252ZXJ0LCBwYXJzZUhlYWRlclZhbHVlLCBtaW1lV29yZHNEZWNvZGUgfSBmcm9tICdlbWFpbGpzLW1pbWUtY29kZWMnXG5pbXBvcnQgeyBUZXh0RW5jb2RlciB9IGZyb20gJ3RleHQtZW5jb2RpbmcnXG5pbXBvcnQgcGFyc2VBZGRyZXNzIGZyb20gJ2VtYWlsanMtYWRkcmVzc3BhcnNlcidcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWltZU5vZGUge1xuICBjb25zdHJ1Y3RvciAoKSB7XG4gICAgdGhpcy5oZWFkZXIgPSBbXSAvLyBBbiBhcnJheSBvZiB1bmZvbGRlZCBoZWFkZXIgbGluZXNcbiAgICB0aGlzLmhlYWRlcnMgPSB7fSAvLyBBbiBvYmplY3QgdGhhdCBob2xkcyBoZWFkZXIga2V5PXZhbHVlIHBhaXJzXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gJydcbiAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXSAvLyBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIG1lc3NhZ2UvcmZjODIyIG1pbWUgcGFydCwgdGhlIHZhbHVlIHdpbGwgYmUgY29udmVydGVkIHRvIGFycmF5IGFuZCBob2xkIGFsbCBjaGlsZCBub2RlcyBmb3IgdGhpcyBub2RlXG4gICAgdGhpcy5yYXcgPSAnJyAvLyBTdG9yZXMgdGhlIHJhdyBjb250ZW50IG9mIHRoaXMgbm9kZVxuXG4gICAgdGhpcy5fc3RhdGUgPSAnSEVBREVSJyAvLyBDdXJyZW50IHN0YXRlLCBhbHdheXMgc3RhcnRzIG91dCB3aXRoIEhFQURFUlxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJyAvLyBCb2R5IGJ1ZmZlclxuICAgIHRoaXMuX2xpbmVDb3VudCA9IDAgLy8gTGluZSBjb3VudGVyIGJvciB0aGUgYm9keSBwYXJ0XG4gICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2UgLy8gQWN0aXZlIGNoaWxkIG5vZGUgKGlmIGF2YWlsYWJsZSlcbiAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJycgLy8gUmVtYWluZGVyIHN0cmluZyB3aGVuIGRlYWxpbmcgd2l0aCBiYXNlNjQgYW5kIHFwIHZhbHVlc1xuICAgIHRoaXMuX2lzTXVsdGlwYXJ0ID0gZmFsc2UgLy8gSW5kaWNhdGVzIGlmIHRoaXMgaXMgYSBtdWx0aXBhcnQgbm9kZVxuICAgIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID0gZmFsc2UgLy8gU3RvcmVzIGJvdW5kYXJ5IHZhbHVlIGZvciBjdXJyZW50IG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5faXNSZmM4MjIgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG1lc3NhZ2UvcmZjODIyIG5vZGVcbiAgfVxuXG4gIHdyaXRlTGluZSAobGluZSkge1xuICAgIHRoaXMucmF3ICs9ICh0aGlzLnJhdyA/ICdcXG4nIDogJycpICsgbGluZVxuXG4gICAgaWYgKHRoaXMuX3N0YXRlID09PSAnSEVBREVSJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0hlYWRlckxpbmUobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3N0YXRlID09PSAnQk9EWScpIHtcbiAgICAgIHRoaXMuX3Byb2Nlc3NCb2R5TGluZShsaW5lKVxuICAgIH1cbiAgfVxuXG4gIGZpbmFsaXplICgpIHtcbiAgICBpZiAodGhpcy5faXNSZmM4MjIpIHtcbiAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2VtaXRCb2R5KClcbiAgICB9XG5cbiAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgPSB0aGlzLmNoaWxkTm9kZXNcbiAgICAucmVkdWNlKChhZ2csIGNoaWxkKSA9PiBhZ2cgKyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnXFxuJyArIGNoaWxkLmJvZHlzdHJ1Y3R1cmUsIHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbicpICtcbiAgICAodGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS1cXG4nIDogJycpXG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgSEVBREVSIHN0YXRlLiBJdCB0aGUgbGluZSBpcyBlbXB0eSwgY2hhbmdlIHN0YXRlIHRvIEJPRFlcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0hlYWRlckxpbmUgKGxpbmUpIHtcbiAgICBpZiAoIWxpbmUpIHtcbiAgICAgIHRoaXMuX3BhcnNlSGVhZGVycygpXG4gICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJ1xuICAgICAgdGhpcy5fc3RhdGUgPSAnQk9EWSdcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChsaW5lLm1hdGNoKC9eXFxzLykgJiYgdGhpcy5oZWFkZXIubGVuZ3RoKSB7XG4gICAgICB0aGlzLmhlYWRlclt0aGlzLmhlYWRlci5sZW5ndGggLSAxXSArPSAnXFxuJyArIGxpbmVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5oZWFkZXIucHVzaChsaW5lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBmb2xkZWQgaGVhZGVyIGxpbmVzIGFuZCBjYWxscyBDb250ZW50LVR5cGUgYW5kIFRyYW5zZmVyLUVuY29kaW5nIHByb2Nlc3NvcnNcbiAgICovXG4gIF9wYXJzZUhlYWRlcnMgKCkge1xuICAgIGZvciAobGV0IGhhc0JpbmFyeSA9IGZhbHNlLCBpID0gMCwgbGVuID0gdGhpcy5oZWFkZXIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGxldCB2YWx1ZSA9IHRoaXMuaGVhZGVyW2ldLnNwbGl0KCc6JylcbiAgICAgIGNvbnN0IGtleSA9ICh2YWx1ZS5zaGlmdCgpIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgdmFsdWUgPSAodmFsdWUuam9pbignOicpIHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJycpLnRyaW0oKVxuXG4gICAgICBpZiAodmFsdWUubWF0Y2goL1tcXHUwMDgwLVxcdUZGRkZdLykpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgICBoYXNCaW5hcnkgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgLy8gdXNlIGRlZmF1bHQgY2hhcnNldCBhdCBmaXJzdCBhbmQgaWYgdGhlIGFjdHVhbCBjaGFyc2V0IGlzIHJlc29sdmVkLCB0aGUgY29udmVyc2lvbiBpcyByZS1ydW5cbiAgICAgICAgdmFsdWUgPSBkZWNvZGUoY29udmVydChzdHIyYXJyKHZhbHVlKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJykpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuaGVhZGVyc1trZXldID0gKHRoaXMuaGVhZGVyc1trZXldIHx8IFtdKS5jb25jYXQoW3RoaXMuX3BhcnNlSGVhZGVyVmFsdWUoa2V5LCB2YWx1ZSldKVxuXG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiBrZXkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuaGVhZGVyc1trZXldW3RoaXMuaGVhZGVyc1trZXldLmxlbmd0aCAtIDFdLnBhcmFtcy5jaGFyc2V0XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXNCaW5hcnkgJiYgdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgIC8vIHJlc2V0IHZhbHVlcyBhbmQgc3RhcnQgb3ZlciBvbmNlIGNoYXJzZXQgaGFzIGJlZW4gcmVzb2x2ZWQgYW5kIDhiaXQgY29udGVudCBoYXMgYmVlbiBmb3VuZFxuICAgICAgICBoYXNCaW5hcnkgPSBmYWxzZVxuICAgICAgICB0aGlzLmhlYWRlcnMgPSB7fVxuICAgICAgICBpID0gLTEgLy8gbmV4dCBpdGVyYXRpb24gaGFzIGkgPT0gMFxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX3Byb2Nlc3NDb250ZW50VHlwZSgpXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgc2luZ2xlIGhlYWRlciB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEhlYWRlciBrZXlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlIFZhbHVlIGZvciB0aGUga2V5XG4gICAqIEByZXR1cm4ge09iamVjdH0gcGFyc2VkIGhlYWRlclxuICAgKi9cbiAgX3BhcnNlSGVhZGVyVmFsdWUgKGtleSwgdmFsdWUpIHtcbiAgICBsZXQgcGFyc2VkVmFsdWVcbiAgICBsZXQgaXNBZGRyZXNzID0gZmFsc2VcblxuICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICBjYXNlICdjb250ZW50LXR5cGUnOlxuICAgICAgY2FzZSAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZyc6XG4gICAgICBjYXNlICdjb250ZW50LWRpc3Bvc2l0aW9uJzpcbiAgICAgIGNhc2UgJ2RraW0tc2lnbmF0dXJlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZnJvbSc6XG4gICAgICBjYXNlICdzZW5kZXInOlxuICAgICAgY2FzZSAndG8nOlxuICAgICAgY2FzZSAncmVwbHktdG8nOlxuICAgICAgY2FzZSAnY2MnOlxuICAgICAgY2FzZSAnYmNjJzpcbiAgICAgIGNhc2UgJ2FidXNlLXJlcG9ydHMtdG8nOlxuICAgICAgY2FzZSAnZXJyb3JzLXRvJzpcbiAgICAgIGNhc2UgJ3JldHVybi1wYXRoJzpcbiAgICAgIGNhc2UgJ2RlbGl2ZXJlZC10byc6XG4gICAgICAgIGlzQWRkcmVzcyA9IHRydWVcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IFtdLmNvbmNhdChwYXJzZUFkZHJlc3ModmFsdWUpIHx8IFtdKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHRoaXMuX3BhcnNlRGF0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgIH1cbiAgICB9XG4gICAgcGFyc2VkVmFsdWUuaW5pdGlhbCA9IHZhbHVlXG5cbiAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHBhcnNlZFZhbHVlLCB7IGlzQWRkcmVzcyB9KVxuXG4gICAgcmV0dXJuIHBhcnNlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZGF0ZSBzdHJpbmcgY2FuIGJlIHBhcnNlZC4gRmFsbHMgYmFjayByZXBsYWNpbmcgdGltZXpvbmVcbiAgICogYWJicmV2YXRpb25zIHdpdGggdGltZXpvbmUgdmFsdWVzLiBCb2d1cyB0aW1lem9uZXMgZGVmYXVsdCB0byBVVEMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgRGF0ZSBoZWFkZXJcbiAgICogQHJldHVybnMge1N0cmluZ30gVVRDIGRhdGUgc3RyaW5nIGlmIHBhcnNpbmcgc3VjY2VlZGVkLCBvdGhlcndpc2UgcmV0dXJucyBpbnB1dCB2YWx1ZVxuICAgKi9cbiAgX3BhcnNlRGF0ZSAoc3RyID0gJycpIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyLnRyaW0oKS5yZXBsYWNlKC9cXGJbYS16XSskL2ksIHR6ID0+IHRpbWV6b25lW3R6LnRvVXBwZXJDYXNlKCldIHx8ICcrMDAwMCcpKVxuICAgIHJldHVybiAoZGF0ZS50b1N0cmluZygpICE9PSAnSW52YWxpZCBEYXRlJykgPyBkYXRlLnRvVVRDU3RyaW5nKCkucmVwbGFjZSgvR01ULywgJyswMDAwJykgOiBzdHJcbiAgfVxuXG4gIF9kZWNvZGVIZWFkZXJDaGFyc2V0IChwYXJzZWQsIHsgaXNBZGRyZXNzIH0gPSB7fSkge1xuICAgIC8vIGRlY29kZSBkZWZhdWx0IHZhbHVlXG4gICAgaWYgKHR5cGVvZiBwYXJzZWQudmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBwYXJzZWQudmFsdWUgPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnZhbHVlKVxuICAgIH1cblxuICAgIC8vIGRlY29kZSBwb3NzaWJsZSBwYXJhbXNcbiAgICBPYmplY3Qua2V5cyhwYXJzZWQucGFyYW1zIHx8IHt9KS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBhcmFtc1trZXldID09PSAnc3RyaW5nJykge1xuICAgICAgICBwYXJzZWQucGFyYW1zW2tleV0gPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnBhcmFtc1trZXldKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBkZWNvZGUgYWRkcmVzc2VzXG4gICAgaWYgKGlzQWRkcmVzcyAmJiBBcnJheS5pc0FycmF5KHBhcnNlZC52YWx1ZSkpIHtcbiAgICAgIHBhcnNlZC52YWx1ZS5mb3JFYWNoKGFkZHIgPT4ge1xuICAgICAgICBpZiAoYWRkci5uYW1lKSB7XG4gICAgICAgICAgYWRkci5uYW1lID0gbWltZVdvcmRzRGVjb2RlKGFkZHIubmFtZSlcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhZGRyLmdyb3VwKSkge1xuICAgICAgICAgICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldCh7IHZhbHVlOiBhZGRyLmdyb3VwIH0sIHsgaXNBZGRyZXNzOiB0cnVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UeXBlIHZhbHVlIGFuZCBzZWxlY3RzIGZvbGxvd2luZyBhY3Rpb25zLlxuICAgKi9cbiAgX3Byb2Nlc3NDb250ZW50VHlwZSAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgndGV4dC9wbGFpbicpXG4gICAgdGhpcy5jb250ZW50VHlwZSA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXR5cGUnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFR5cGUudmFsdWUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnNoaWZ0KCkgfHwgJ3RleHQnKVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUucGFyYW1zICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldFxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPT09ICdtdWx0aXBhcnQnICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5KSB7XG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXVxuICAgICAgdGhpcy5faXNNdWx0aXBhcnQgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnBvcCgpIHx8ICdtaXhlZCcpXG4gICAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRm9yIGF0dGFjaG1lbnQgKGlubGluZS9yZWd1bGFyKSBpZiBjaGFyc2V0IGlzIG5vdCBkZWZpbmVkIGFuZCBhdHRhY2htZW50IGlzIG5vbi10ZXh0LyosXG4gICAgICogdGhlbiBkZWZhdWx0IGNoYXJzZXQgdG8gYmluYXJ5LlxuICAgICAqIFJlZmVyIHRvIGlzc3VlOiBodHRwczovL2dpdGh1Yi5jb20vZW1haWxqcy9lbWFpbGpzLW1pbWUtcGFyc2VyL2lzc3Vlcy8xOFxuICAgICAqL1xuICAgIGNvbnN0IGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gcGF0aE9yKGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLCAnMCddKSh0aGlzKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnYXR0YWNobWVudCdcbiAgICBjb25zdCBpc0lubGluZUF0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2lubGluZSdcbiAgICBpZiAoKGlzQXR0YWNobWVudCB8fCBpc0lubGluZUF0dGFjaG1lbnQpICYmIHRoaXMuY29udGVudFR5cGUudHlwZSAhPT0gJ3RleHQnICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9ICdiaW5hcnknXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudmFsdWUgPT09ICdtZXNzYWdlL3JmYzgyMicgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBQYXJzZSBtZXNzYWdlL3JmYzgyMiBvbmx5IGlmIHRoZSBtaW1lIHBhcnQgaXMgbm90IG1hcmtlZCB3aXRoIGNvbnRlbnQtZGlzcG9zaXRpb246IGF0dGFjaG1lbnQsXG4gICAgICAgKiBvdGhlcndpc2UgdHJlYXQgaXQgbGlrZSBhIHJlZ3VsYXIgYXR0YWNobWVudFxuICAgICAgICovXG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcylcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFt0aGlzLl9jdXJyZW50Q2hpbGRdXG4gICAgICB0aGlzLl9pc1JmYzgyMiA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHJhbnNmZXItRW5jb2RpbmcgdmFsdWUgdG8gc2VlIGlmIHRoZSBib2R5IG5lZWRzIHRvIGJlIGNvbnZlcnRlZFxuICAgKiBiZWZvcmUgaXQgY2FuIGJlIGVtaXR0ZWRcbiAgICovXG4gIF9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJzdiaXQnKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZycsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9IHBhdGhPcignJywgWydjb250ZW50VHJhbnNmZXJFbmNvZGluZycsICd2YWx1ZSddKSh0aGlzKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEJPRFkgc3RhdGUuIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgcmZjODIyIG5vZGUsXG4gICAqIHBhc3NlcyBsaW5lIHZhbHVlIHRvIGNoaWxkIG5vZGVzLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICovXG4gIF9wcm9jZXNzQm9keUxpbmUgKGxpbmUpIHtcbiAgICB0aGlzLl9saW5lQ291bnQrK1xuXG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0KSB7XG4gICAgICBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5KSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMpXG4gICAgICAgIHRoaXMuY2hpbGROb2Rlcy5wdXNoKHRoaXMuX2N1cnJlbnRDaGlsZClcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJy0tJykge1xuICAgICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gbGluZSArICdcXG4nXG4gICAgICAgIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZ25vcmUgbXVsdGlwYXJ0IHByZWFtYmxlXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLndyaXRlTGluZShsaW5lKVxuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgICAgY2FzZSAnYmFzZTY0Jzoge1xuICAgICAgICAgIGxldCBjdXJMaW5lID0gdGhpcy5fbGluZVJlbWFpbmRlciArIGxpbmUudHJpbSgpXG5cbiAgICAgICAgICBpZiAoY3VyTGluZS5sZW5ndGggJSA0KSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gY3VyTGluZS5zdWJzdHIoLWN1ckxpbmUubGVuZ3RoICUgNClcbiAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoY3VyTGluZS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gYmFzZTY0RGVjb2RlKGN1ckxpbmUsIHRoaXMuY2hhcnNldClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJ3F1b3RlZC1wcmludGFibGUnOiB7XG4gICAgICAgICAgbGV0IGN1ckxpbmUgPSB0aGlzLl9saW5lUmVtYWluZGVyICsgKHRoaXMuX2xpbmVDb3VudCA+IDEgPyAnXFxuJyA6ICcnKSArIGxpbmVcbiAgICAgICAgICBjb25zdCBtYXRjaCA9IGN1ckxpbmUubWF0Y2goLz1bYS1mMC05XXswLDF9JC9pKVxuICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9IG1hdGNoWzBdXG4gICAgICAgICAgICBjdXJMaW5lID0gY3VyTGluZS5zdWJzdHIoMCwgY3VyTGluZS5sZW5ndGggLSB0aGlzLl9saW5lUmVtYWluZGVyLmxlbmd0aClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciArPSBjdXJMaW5lLnJlcGxhY2UoLz0oXFxyP1xcbnwkKS9nLCAnJykucmVwbGFjZSgvPShbYS1mMC05XXsyfSkvaWcsIGZ1bmN0aW9uIChtLCBjb2RlKSB7XG4gICAgICAgICAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZShwYXJzZUludChjb2RlLCAxNikpXG4gICAgICAgICAgfSlcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJzdiaXQnOlxuICAgICAgICBjYXNlICc4Yml0JzpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9ICh0aGlzLl9saW5lQ291bnQgPiAxID8gJ1xcbicgOiAnJykgKyBsaW5lXG4gICAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjaHVuayBvZiB0aGUgYm9keVxuICAqL1xuICBfZW1pdEJvZHkgKCkge1xuICAgIGlmICh0aGlzLl9pc011bHRpcGFydCB8fCAhdGhpcy5fYm9keUJ1ZmZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJvY2Vzc0Zsb3dlZFRleHQoKVxuICAgIHRoaXMuY29udGVudCA9IHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICB0aGlzLl9wcm9jZXNzSHRtbFRleHQoKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJ1xuICB9XG5cbiAgX3Byb2Nlc3NGbG93ZWRUZXh0ICgpIHtcbiAgICBjb25zdCBpc1RleHQgPSAvXnRleHRcXC8ocGxhaW58aHRtbCkkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKVxuICAgIGNvbnN0IGlzRmxvd2VkID0gL15mbG93ZWQkL2kudGVzdChwYXRoT3IoJycsIFsnY29udGVudFR5cGUnLCAncGFyYW1zJywgJ2Zvcm1hdCddKSh0aGlzKSlcbiAgICBpZiAoIWlzVGV4dCB8fCAhaXNGbG93ZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVsU3AgPSAvXnllcyQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUucGFyYW1zLmRlbHNwKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSB0aGlzLl9ib2R5QnVmZmVyLnNwbGl0KCdcXG4nKVxuICAgICAgLnJlZHVjZShmdW5jdGlvbiAocHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlKSB7XG4gICAgICAgIC8vIHJlbW92ZSBzb2Z0IGxpbmVicmVha3MgYWZ0ZXIgc3BhY2Ugc3ltYm9scy5cbiAgICAgICAgLy8gZGVsc3AgYWRkcyBzcGFjZXMgdG8gdGV4dCB0byBiZSBhYmxlIHRvIGZvbGQgaXQuXG4gICAgICAgIC8vIHRoZXNlIHNwYWNlcyBjYW4gYmUgcmVtb3ZlZCBvbmNlIHRoZSB0ZXh0IGlzIHVuZm9sZGVkXG4gICAgICAgIGNvbnN0IGVuZHNXaXRoU3BhY2UgPSAvICQvLnRlc3QocHJldmlvdXNWYWx1ZSlcbiAgICAgICAgY29uc3QgaXNCb3VuZGFyeSA9IC8oXnxcXG4pLS0gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICByZXR1cm4gKGRlbFNwID8gcHJldmlvdXNWYWx1ZS5yZXBsYWNlKC9bIF0rJC8sICcnKSA6IHByZXZpb3VzVmFsdWUpICsgKChlbmRzV2l0aFNwYWNlICYmICFpc0JvdW5kYXJ5KSA/ICcnIDogJ1xcbicpICsgY3VycmVudFZhbHVlXG4gICAgICB9KVxuICAgICAgLnJlcGxhY2UoL14gL2dtLCAnJykgLy8gcmVtb3ZlIHdoaXRlc3BhY2Ugc3R1ZmZpbmcgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzY3NiNzZWN0aW9uLTQuNFxuICB9XG5cbiAgX3Byb2Nlc3NIdG1sVGV4dCAoKSB7XG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gKHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddICYmIHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddWzBdKSB8fCBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGlzSHRtbCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNBdHRhY2htZW50ID0gL15hdHRhY2htZW50JC9pLnRlc3QoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlKVxuICAgIGlmIChpc0h0bWwgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYgL150ZXh0XFwvaHRtbCQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuX2RldGVjdEhUTUxDaGFyc2V0KHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgICB9XG5cbiAgICAgIC8vIGRlY29kZSBcImJpbmFyeVwiIHN0cmluZyB0byBhbiB1bmljb2RlIHN0cmluZ1xuICAgICAgaWYgKCEvXnV0ZlstX10/OCQvaS50ZXN0KHRoaXMuY2hhcnNldCkpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gY29udmVydChzdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpLCB0aGlzLmNoYXJzZXQgfHwgJ2lzby04ODU5LTEnKVxuICAgICAgfVxuXG4gICAgICAvLyBvdmVycmlkZSBjaGFyc2V0IGZvciB0ZXh0IG5vZGVzXG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ID0gJ3V0Zi04J1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlY3QgY2hhcnNldCBmcm9tIGEgaHRtbCBmaWxlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBodG1sIElucHV0IEhUTUxcbiAgICogQHJldHVybnMge1N0cmluZ30gQ2hhcnNldCBpZiBmb3VuZCBvciB1bmRlZmluZWRcbiAgICovXG4gIF9kZXRlY3RIVE1MQ2hhcnNldCAoaHRtbCkge1xuICAgIGxldCBjaGFyc2V0LCBpbnB1dFxuXG4gICAgaHRtbCA9IGh0bWwucmVwbGFjZSgvXFxyP1xcbnxcXHIvZywgJyAnKVxuICAgIGxldCBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMraHR0cC1lcXVpdj1bXCInXFxzXSpjb250ZW50LXR5cGVbXj5dKj8+L2kpXG4gICAgaWYgKG1ldGEpIHtcbiAgICAgIGlucHV0ID0gbWV0YVswXVxuICAgIH1cblxuICAgIGlmIChpbnB1dCkge1xuICAgICAgY2hhcnNldCA9IGlucHV0Lm1hdGNoKC9jaGFyc2V0XFxzPz1cXHM/KFthLXpBLVpcXC1fOjAtOV0qKTs/LylcbiAgICAgIGlmIChjaGFyc2V0KSB7XG4gICAgICAgIGNoYXJzZXQgPSAoY2hhcnNldFsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMrY2hhcnNldD1bXCInXFxzXSooW15cIic8Pi9cXHNdKykvaSlcbiAgICBpZiAoIWNoYXJzZXQgJiYgbWV0YSkge1xuICAgICAgY2hhcnNldCA9IChtZXRhWzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFyc2V0XG4gIH1cbn1cblxuY29uc3Qgc3RyMmFyciA9IHN0ciA9PiBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKVxuIl19