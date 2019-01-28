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
    this._base64BodyBuffer = ''; // Body buffer in base64
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

      console.log(this._bodyBuffer);
    }
  }, {
    key: '_base64DecodeBodyBuffer',
    value: function _base64DecodeBodyBuffer() {
      if (this._base64BodyBuffer) {
        this._bodyBuffer = (0, _emailjsMimeCodec.base64Decode)(this._base64BodyBuffer, this.charset);
      }
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
              this._base64BodyBuffer += line;
              break;
            }
          case 'quoted-printable':
            {
              var curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line;
              var match = curLine.match(/=[a-f0-9]{0,1}$/i);
              if (match) {
                this._lineRemainder = match[0];
                curLine = curLine.substr(0, curLine.length - this._lineRemainder.length);
              } else {
                this._lineRemainder = '';
              }

              this._bodyBuffer += curLine.replace(/=(\r?\n|$)/g, '').replace(/=([a-f0-9]{2})/ig, function (m, code) {
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
      this._base64DecodeBodyBuffer();
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
        } else if (this.contentTransferEncoding && this.contentTransferEncoding.value === 'base64') {
          this.content = utf8Str2arr(this._bodyBuffer);
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
  return new Uint8Array(str.split('').map(function (char) {
    return char.charCodeAt(0);
  }));
};

var utf8Str2arr = function utf8Str2arr(str) {
  return new _textEncoding.TextEncoder('utf-8').encode(str);
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9ub2RlLmpzIl0sIm5hbWVzIjpbIk1pbWVOb2RlIiwiaGVhZGVyIiwiaGVhZGVycyIsImJvZHlzdHJ1Y3R1cmUiLCJjaGlsZE5vZGVzIiwicmF3IiwiX3N0YXRlIiwiX2JvZHlCdWZmZXIiLCJfYmFzZTY0Qm9keUJ1ZmZlciIsIl9saW5lQ291bnQiLCJfY3VycmVudENoaWxkIiwiX2xpbmVSZW1haW5kZXIiLCJfaXNNdWx0aXBhcnQiLCJfbXVsdGlwYXJ0Qm91bmRhcnkiLCJfaXNSZmM4MjIiLCJsaW5lIiwiX3Byb2Nlc3NIZWFkZXJMaW5lIiwiX3Byb2Nlc3NCb2R5TGluZSIsImZpbmFsaXplIiwiX2VtaXRCb2R5IiwicmVkdWNlIiwiYWdnIiwiY2hpbGQiLCJqb2luIiwiY29uc29sZSIsImxvZyIsImNoYXJzZXQiLCJfcGFyc2VIZWFkZXJzIiwibWF0Y2giLCJsZW5ndGgiLCJwdXNoIiwiaGFzQmluYXJ5IiwiaSIsImxlbiIsInZhbHVlIiwic3BsaXQiLCJrZXkiLCJzaGlmdCIsInRyaW0iLCJ0b0xvd2VyQ2FzZSIsInJlcGxhY2UiLCJzdHIyYXJyIiwiY29uY2F0IiwiX3BhcnNlSGVhZGVyVmFsdWUiLCJwYXJhbXMiLCJfcHJvY2Vzc0NvbnRlbnRUeXBlIiwiX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInBhcnNlZFZhbHVlIiwiaXNBZGRyZXNzIiwiX3BhcnNlRGF0ZSIsImluaXRpYWwiLCJfZGVjb2RlSGVhZGVyQ2hhcnNldCIsInN0ciIsImRhdGUiLCJEYXRlIiwidGltZXpvbmUiLCJ0eiIsInRvVXBwZXJDYXNlIiwidG9TdHJpbmciLCJ0b1VUQ1N0cmluZyIsInBhcnNlZCIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwiQXJyYXkiLCJpc0FycmF5IiwiYWRkciIsIm5hbWUiLCJncm91cCIsImRlZmF1bHRWYWx1ZSIsImNvbnRlbnRUeXBlIiwidHlwZSIsImJvdW5kYXJ5IiwicG9wIiwiZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlIiwiY29udGVudERpc3Bvc2l0aW9uIiwiaXNBdHRhY2htZW50IiwiaXNJbmxpbmVBdHRhY2htZW50IiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ3cml0ZUxpbmUiLCJjdXJMaW5lIiwic3Vic3RyIiwibSIsImNvZGUiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJwYXJzZUludCIsIl9iYXNlNjREZWNvZGVCb2R5QnVmZmVyIiwiX3Byb2Nlc3NGbG93ZWRUZXh0IiwiY29udGVudCIsIl9wcm9jZXNzSHRtbFRleHQiLCJpc1RleHQiLCJ0ZXN0IiwiaXNGbG93ZWQiLCJkZWxTcCIsImRlbHNwIiwicHJldmlvdXNWYWx1ZSIsImN1cnJlbnRWYWx1ZSIsImVuZHNXaXRoU3BhY2UiLCJpc0JvdW5kYXJ5IiwiaXNIdG1sIiwiX2RldGVjdEhUTUxDaGFyc2V0IiwidXRmOFN0cjJhcnIiLCJodG1sIiwiaW5wdXQiLCJtZXRhIiwiVWludDhBcnJheSIsIm1hcCIsImNoYXIiLCJjaGFyQ29kZUF0IiwiVGV4dEVuY29kZXIiLCJlbmNvZGUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7Ozs7Ozs7SUFFcUJBLFE7QUFDbkIsc0JBQWU7QUFBQTs7QUFDYixTQUFLQyxNQUFMLEdBQWMsRUFBZCxDQURhLENBQ0k7QUFDakIsU0FBS0MsT0FBTCxHQUFlLEVBQWYsQ0FGYSxDQUVLO0FBQ2xCLFNBQUtDLGFBQUwsR0FBcUIsRUFBckI7QUFDQSxTQUFLQyxVQUFMLEdBQWtCLEVBQWxCLENBSmEsQ0FJUTtBQUNyQixTQUFLQyxHQUFMLEdBQVcsRUFBWCxDQUxhLENBS0M7O0FBRWQsU0FBS0MsTUFBTCxHQUFjLFFBQWQsQ0FQYSxDQU9VO0FBQ3ZCLFNBQUtDLFdBQUwsR0FBbUIsRUFBbkIsQ0FSYSxDQVFTO0FBQ3RCLFNBQUtDLGlCQUFMLEdBQXlCLEVBQXpCLENBVGEsQ0FTZTtBQUM1QixTQUFLQyxVQUFMLEdBQWtCLENBQWxCLENBVmEsQ0FVTztB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QUF2QixFQUFWO0FBQ0Q7O0FBRUQsYUFBT2IsT0FBUDtBQUNEOzs7Ozs7a0JBcFlrQjFCLFE7OztBQXVZckIsSUFBTXlDLFVBQVUsU0FBVkEsT0FBVTtBQUFBLFNBQU8sSUFBSWlFLFVBQUosQ0FBZXRELElBQUlqQixLQUFKLENBQVUsRUFBVixFQUFjd0UsR0FBZCxDQUFrQjtBQUFBLFdBQVFDLEtBQUtDLFVBQUwsQ0FBZ0IsQ0FBaEIsQ0FBUjtBQUFBLEdBQWxCLENBQWYsQ0FBUDtBQUFBLENBQWhCOztBQUVBLElBQU1QLGNBQWMsU0FBZEEsV0FBYztBQUFBLFNBQU8sSUFBSVEseUJBQUosQ0FBZ0IsT0FBaEIsRUFBeUJDLE1BQXpCLENBQWdDM0QsR0FBaEMsQ0FBUDtBQUFBLENBQXBCIiwiZmlsZSI6Im5vZGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBwYXRoT3IgfSBmcm9tICdyYW1kYSdcbmltcG9ydCB0aW1lem9uZSBmcm9tICcuL3RpbWV6b25lcydcbmltcG9ydCB7IGRlY29kZSwgYmFzZTY0RGVjb2RlLCBjb252ZXJ0LCBwYXJzZUhlYWRlclZhbHVlLCBtaW1lV29yZHNEZWNvZGUgfSBmcm9tICdlbWFpbGpzLW1pbWUtY29kZWMnXG5pbXBvcnQgeyBUZXh0RW5jb2RlciB9IGZyb20gJ3RleHQtZW5jb2RpbmcnXG5pbXBvcnQgcGFyc2VBZGRyZXNzIGZyb20gJ2VtYWlsanMtYWRkcmVzc3BhcnNlcidcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWltZU5vZGUge1xuICBjb25zdHJ1Y3RvciAoKSB7XG4gICAgdGhpcy5oZWFkZXIgPSBbXSAvLyBBbiBhcnJheSBvZiB1bmZvbGRlZCBoZWFkZXIgbGluZXNcbiAgICB0aGlzLmhlYWRlcnMgPSB7fSAvLyBBbiBvYmplY3QgdGhhdCBob2xkcyBoZWFkZXIga2V5PXZhbHVlIHBhaXJzXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gJydcbiAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXSAvLyBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIG1lc3NhZ2UvcmZjODIyIG1pbWUgcGFydCwgdGhlIHZhbHVlIHdpbGwgYmUgY29udmVydGVkIHRvIGFycmF5IGFuZCBob2xkIGFsbCBjaGlsZCBub2RlcyBmb3IgdGhpcyBub2RlXG4gICAgdGhpcy5yYXcgPSAnJyAvLyBTdG9yZXMgdGhlIHJhdyBjb250ZW50IG9mIHRoaXMgbm9kZVxuXG4gICAgdGhpcy5fc3RhdGUgPSAnSEVBREVSJyAvLyBDdXJyZW50IHN0YXRlLCBhbHdheXMgc3RhcnRzIG91dCB3aXRoIEhFQURFUlxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJyAvLyBCb2R5IGJ1ZmZlclxuICAgIHRoaXMuX2Jhc2U2NEJvZHlCdWZmZXIgPSAnJyAvLyBCb2R5IGJ1ZmZlciBpbiBiYXNlNjRcbiAgICB0aGlzLl9saW5lQ291bnQgPSAwIC8vIExpbmUgY291bnRlciBib3IgdGhlIGJvZHkgcGFydFxuICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlIC8vIEFjdGl2ZSBjaGlsZCBub2RlIChpZiBhdmFpbGFibGUpXG4gICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnIC8vIFJlbWFpbmRlciBzdHJpbmcgd2hlbiBkZWFsaW5nIHdpdGggYmFzZTY0IGFuZCBxcCB2YWx1ZXNcbiAgICB0aGlzLl9pc011bHRpcGFydCA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IGZhbHNlIC8vIFN0b3JlcyBib3VuZGFyeSB2YWx1ZSBmb3IgY3VycmVudCBtdWx0aXBhcnQgbm9kZVxuICAgIHRoaXMuX2lzUmZjODIyID0gZmFsc2UgLy8gSW5kaWNhdGVzIGlmIHRoaXMgaXMgYSBtZXNzYWdlL3JmYzgyMiBub2RlXG4gIH1cblxuICB3cml0ZUxpbmUgKGxpbmUpIHtcbiAgICB0aGlzLnJhdyArPSAodGhpcy5yYXcgPyAnXFxuJyA6ICcnKSArIGxpbmVcblxuICAgIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0hFQURFUicpIHtcbiAgICAgIHRoaXMuX3Byb2Nlc3NIZWFkZXJMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0JPRFknKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzQm9keUxpbmUobGluZSlcbiAgICB9XG4gIH1cblxuICBmaW5hbGl6ZSAoKSB7XG4gICAgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9lbWl0Qm9keSgpXG4gICAgfVxuXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gdGhpcy5jaGlsZE5vZGVzXG4gICAgLnJlZHVjZSgoYWdnLCBjaGlsZCkgPT4gYWdnICsgJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJ1xcbicgKyBjaGlsZC5ib2R5c3RydWN0dXJlLCB0aGlzLmhlYWRlci5qb2luKCdcXG4nKSArICdcXG5cXG4nKSArXG4gICAgICAodGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS1cXG4nIDogJycpXG5cbiAgICBjb25zb2xlLmxvZyh0aGlzLl9ib2R5QnVmZmVyKVxuICB9XG5cbiAgX2Jhc2U2NERlY29kZUJvZHlCdWZmZXIgKCkge1xuICAgIGlmICh0aGlzLl9iYXNlNjRCb2R5QnVmZmVyKSB7XG4gICAgICB0aGlzLl9ib2R5QnVmZmVyID0gYmFzZTY0RGVjb2RlKHRoaXMuX2Jhc2U2NEJvZHlCdWZmZXIsIHRoaXMuY2hhcnNldClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgSEVBREVSIHN0YXRlLiBJdCB0aGUgbGluZSBpcyBlbXB0eSwgY2hhbmdlIHN0YXRlIHRvIEJPRFlcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0hlYWRlckxpbmUgKGxpbmUpIHtcbiAgICBpZiAoIWxpbmUpIHtcbiAgICAgIHRoaXMuX3BhcnNlSGVhZGVycygpXG4gICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJ1xuICAgICAgdGhpcy5fc3RhdGUgPSAnQk9EWSdcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChsaW5lLm1hdGNoKC9eXFxzLykgJiYgdGhpcy5oZWFkZXIubGVuZ3RoKSB7XG4gICAgICB0aGlzLmhlYWRlclt0aGlzLmhlYWRlci5sZW5ndGggLSAxXSArPSAnXFxuJyArIGxpbmVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5oZWFkZXIucHVzaChsaW5lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBmb2xkZWQgaGVhZGVyIGxpbmVzIGFuZCBjYWxscyBDb250ZW50LVR5cGUgYW5kIFRyYW5zZmVyLUVuY29kaW5nIHByb2Nlc3NvcnNcbiAgICovXG4gIF9wYXJzZUhlYWRlcnMgKCkge1xuICAgIGZvciAobGV0IGhhc0JpbmFyeSA9IGZhbHNlLCBpID0gMCwgbGVuID0gdGhpcy5oZWFkZXIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGxldCB2YWx1ZSA9IHRoaXMuaGVhZGVyW2ldLnNwbGl0KCc6JylcbiAgICAgIGNvbnN0IGtleSA9ICh2YWx1ZS5zaGlmdCgpIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgdmFsdWUgPSAodmFsdWUuam9pbignOicpIHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJycpLnRyaW0oKVxuXG4gICAgICBpZiAodmFsdWUubWF0Y2goL1tcXHUwMDgwLVxcdUZGRkZdLykpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgICBoYXNCaW5hcnkgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgLy8gdXNlIGRlZmF1bHQgY2hhcnNldCBhdCBmaXJzdCBhbmQgaWYgdGhlIGFjdHVhbCBjaGFyc2V0IGlzIHJlc29sdmVkLCB0aGUgY29udmVyc2lvbiBpcyByZS1ydW5cbiAgICAgICAgdmFsdWUgPSBkZWNvZGUoY29udmVydChzdHIyYXJyKHZhbHVlKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJykpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuaGVhZGVyc1trZXldID0gKHRoaXMuaGVhZGVyc1trZXldIHx8IFtdKS5jb25jYXQoW3RoaXMuX3BhcnNlSGVhZGVyVmFsdWUoa2V5LCB2YWx1ZSldKVxuXG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiBrZXkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuaGVhZGVyc1trZXldW3RoaXMuaGVhZGVyc1trZXldLmxlbmd0aCAtIDFdLnBhcmFtcy5jaGFyc2V0XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXNCaW5hcnkgJiYgdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgIC8vIHJlc2V0IHZhbHVlcyBhbmQgc3RhcnQgb3ZlciBvbmNlIGNoYXJzZXQgaGFzIGJlZW4gcmVzb2x2ZWQgYW5kIDhiaXQgY29udGVudCBoYXMgYmVlbiBmb3VuZFxuICAgICAgICBoYXNCaW5hcnkgPSBmYWxzZVxuICAgICAgICB0aGlzLmhlYWRlcnMgPSB7fVxuICAgICAgICBpID0gLTEgLy8gbmV4dCBpdGVyYXRpb24gaGFzIGkgPT0gMFxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX3Byb2Nlc3NDb250ZW50VHlwZSgpXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgc2luZ2xlIGhlYWRlciB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEhlYWRlciBrZXlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlIFZhbHVlIGZvciB0aGUga2V5XG4gICAqIEByZXR1cm4ge09iamVjdH0gcGFyc2VkIGhlYWRlclxuICAgKi9cbiAgX3BhcnNlSGVhZGVyVmFsdWUgKGtleSwgdmFsdWUpIHtcbiAgICBsZXQgcGFyc2VkVmFsdWVcbiAgICBsZXQgaXNBZGRyZXNzID0gZmFsc2VcblxuICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICBjYXNlICdjb250ZW50LXR5cGUnOlxuICAgICAgY2FzZSAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZyc6XG4gICAgICBjYXNlICdjb250ZW50LWRpc3Bvc2l0aW9uJzpcbiAgICAgIGNhc2UgJ2RraW0tc2lnbmF0dXJlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZnJvbSc6XG4gICAgICBjYXNlICdzZW5kZXInOlxuICAgICAgY2FzZSAndG8nOlxuICAgICAgY2FzZSAncmVwbHktdG8nOlxuICAgICAgY2FzZSAnY2MnOlxuICAgICAgY2FzZSAnYmNjJzpcbiAgICAgIGNhc2UgJ2FidXNlLXJlcG9ydHMtdG8nOlxuICAgICAgY2FzZSAnZXJyb3JzLXRvJzpcbiAgICAgIGNhc2UgJ3JldHVybi1wYXRoJzpcbiAgICAgIGNhc2UgJ2RlbGl2ZXJlZC10byc6XG4gICAgICAgIGlzQWRkcmVzcyA9IHRydWVcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IFtdLmNvbmNhdChwYXJzZUFkZHJlc3ModmFsdWUpIHx8IFtdKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHRoaXMuX3BhcnNlRGF0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgIH1cbiAgICB9XG4gICAgcGFyc2VkVmFsdWUuaW5pdGlhbCA9IHZhbHVlXG5cbiAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHBhcnNlZFZhbHVlLCB7IGlzQWRkcmVzcyB9KVxuXG4gICAgcmV0dXJuIHBhcnNlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZGF0ZSBzdHJpbmcgY2FuIGJlIHBhcnNlZC4gRmFsbHMgYmFjayByZXBsYWNpbmcgdGltZXpvbmVcbiAgICogYWJicmV2YXRpb25zIHdpdGggdGltZXpvbmUgdmFsdWVzLiBCb2d1cyB0aW1lem9uZXMgZGVmYXVsdCB0byBVVEMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgRGF0ZSBoZWFkZXJcbiAgICogQHJldHVybnMge1N0cmluZ30gVVRDIGRhdGUgc3RyaW5nIGlmIHBhcnNpbmcgc3VjY2VlZGVkLCBvdGhlcndpc2UgcmV0dXJucyBpbnB1dCB2YWx1ZVxuICAgKi9cbiAgX3BhcnNlRGF0ZSAoc3RyID0gJycpIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyLnRyaW0oKS5yZXBsYWNlKC9cXGJbYS16XSskL2ksIHR6ID0+IHRpbWV6b25lW3R6LnRvVXBwZXJDYXNlKCldIHx8ICcrMDAwMCcpKVxuICAgIHJldHVybiAoZGF0ZS50b1N0cmluZygpICE9PSAnSW52YWxpZCBEYXRlJykgPyBkYXRlLnRvVVRDU3RyaW5nKCkucmVwbGFjZSgvR01ULywgJyswMDAwJykgOiBzdHJcbiAgfVxuXG4gIF9kZWNvZGVIZWFkZXJDaGFyc2V0IChwYXJzZWQsIHsgaXNBZGRyZXNzIH0gPSB7fSkge1xuICAgIC8vIGRlY29kZSBkZWZhdWx0IHZhbHVlXG4gICAgaWYgKHR5cGVvZiBwYXJzZWQudmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBwYXJzZWQudmFsdWUgPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnZhbHVlKVxuICAgIH1cblxuICAgIC8vIGRlY29kZSBwb3NzaWJsZSBwYXJhbXNcbiAgICBPYmplY3Qua2V5cyhwYXJzZWQucGFyYW1zIHx8IHt9KS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBhcmFtc1trZXldID09PSAnc3RyaW5nJykge1xuICAgICAgICBwYXJzZWQucGFyYW1zW2tleV0gPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnBhcmFtc1trZXldKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBkZWNvZGUgYWRkcmVzc2VzXG4gICAgaWYgKGlzQWRkcmVzcyAmJiBBcnJheS5pc0FycmF5KHBhcnNlZC52YWx1ZSkpIHtcbiAgICAgIHBhcnNlZC52YWx1ZS5mb3JFYWNoKGFkZHIgPT4ge1xuICAgICAgICBpZiAoYWRkci5uYW1lKSB7XG4gICAgICAgICAgYWRkci5uYW1lID0gbWltZVdvcmRzRGVjb2RlKGFkZHIubmFtZSlcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhZGRyLmdyb3VwKSkge1xuICAgICAgICAgICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldCh7IHZhbHVlOiBhZGRyLmdyb3VwIH0sIHsgaXNBZGRyZXNzOiB0cnVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UeXBlIHZhbHVlIGFuZCBzZWxlY3RzIGZvbGxvd2luZyBhY3Rpb25zLlxuICAgKi9cbiAgX3Byb2Nlc3NDb250ZW50VHlwZSAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgndGV4dC9wbGFpbicpXG4gICAgdGhpcy5jb250ZW50VHlwZSA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXR5cGUnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFR5cGUudmFsdWUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnNoaWZ0KCkgfHwgJ3RleHQnKVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUucGFyYW1zICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldFxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPT09ICdtdWx0aXBhcnQnICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5KSB7XG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXVxuICAgICAgdGhpcy5faXNNdWx0aXBhcnQgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnBvcCgpIHx8ICdtaXhlZCcpXG4gICAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRm9yIGF0dGFjaG1lbnQgKGlubGluZS9yZWd1bGFyKSBpZiBjaGFyc2V0IGlzIG5vdCBkZWZpbmVkIGFuZCBhdHRhY2htZW50IGlzIG5vbi10ZXh0LyosXG4gICAgICogdGhlbiBkZWZhdWx0IGNoYXJzZXQgdG8gYmluYXJ5LlxuICAgICAqIFJlZmVyIHRvIGlzc3VlOiBodHRwczovL2dpdGh1Yi5jb20vZW1haWxqcy9lbWFpbGpzLW1pbWUtcGFyc2VyL2lzc3Vlcy8xOFxuICAgICAqL1xuICAgIGNvbnN0IGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gcGF0aE9yKGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLCAnMCddKSh0aGlzKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnYXR0YWNobWVudCdcbiAgICBjb25zdCBpc0lubGluZUF0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2lubGluZSdcbiAgICBpZiAoKGlzQXR0YWNobWVudCB8fCBpc0lubGluZUF0dGFjaG1lbnQpICYmIHRoaXMuY29udGVudFR5cGUudHlwZSAhPT0gJ3RleHQnICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9ICdiaW5hcnknXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudmFsdWUgPT09ICdtZXNzYWdlL3JmYzgyMicgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBQYXJzZSBtZXNzYWdlL3JmYzgyMiBvbmx5IGlmIHRoZSBtaW1lIHBhcnQgaXMgbm90IG1hcmtlZCB3aXRoIGNvbnRlbnQtZGlzcG9zaXRpb246IGF0dGFjaG1lbnQsXG4gICAgICAgKiBvdGhlcndpc2UgdHJlYXQgaXQgbGlrZSBhIHJlZ3VsYXIgYXR0YWNobWVudFxuICAgICAgICovXG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcylcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFt0aGlzLl9jdXJyZW50Q2hpbGRdXG4gICAgICB0aGlzLl9pc1JmYzgyMiA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHJhbnNmZXItRW5jb2RpbmcgdmFsdWUgdG8gc2VlIGlmIHRoZSBib2R5IG5lZWRzIHRvIGJlIGNvbnZlcnRlZFxuICAgKiBiZWZvcmUgaXQgY2FuIGJlIGVtaXR0ZWRcbiAgICovXG4gIF9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJzdiaXQnKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZycsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9IHBhdGhPcignJywgWydjb250ZW50VHJhbnNmZXJFbmNvZGluZycsICd2YWx1ZSddKSh0aGlzKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEJPRFkgc3RhdGUuIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgcmZjODIyIG5vZGUsXG4gICAqIHBhc3NlcyBsaW5lIHZhbHVlIHRvIGNoaWxkIG5vZGVzLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICovXG4gIF9wcm9jZXNzQm9keUxpbmUgKGxpbmUpIHtcbiAgICB0aGlzLl9saW5lQ291bnQrK1xuXG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0KSB7XG4gICAgICBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5KSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMpXG4gICAgICAgIHRoaXMuY2hpbGROb2Rlcy5wdXNoKHRoaXMuX2N1cnJlbnRDaGlsZClcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJy0tJykge1xuICAgICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gbGluZSArICdcXG4nXG4gICAgICAgIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZ25vcmUgbXVsdGlwYXJ0IHByZWFtYmxlXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLndyaXRlTGluZShsaW5lKVxuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgICAgY2FzZSAnYmFzZTY0Jzoge1xuICAgICAgICAgIHRoaXMuX2Jhc2U2NEJvZHlCdWZmZXIgKz0gbGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6IHtcbiAgICAgICAgICBsZXQgY3VyTGluZSA9IHRoaXMuX2xpbmVSZW1haW5kZXIgKyAodGhpcy5fbGluZUNvdW50ID4gMSA/ICdcXG4nIDogJycpICsgbGluZVxuICAgICAgICAgIGNvbnN0IG1hdGNoID0gY3VyTGluZS5tYXRjaCgvPVthLWYwLTldezAsMX0kL2kpXG4gICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gbWF0Y2hbMF1cbiAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGN1ckxpbmUucmVwbGFjZSgvPShcXHI/XFxufCQpL2csICcnKS5yZXBsYWNlKC89KFthLWYwLTldezJ9KS9pZywgZnVuY3Rpb24gKG0sIGNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKHBhcnNlSW50KGNvZGUsIDE2KSlcbiAgICAgICAgICB9KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnN2JpdCc6XG4gICAgICAgIGNhc2UgJzhiaXQnOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gKHRoaXMuX2xpbmVDb3VudCA+IDEgPyAnXFxuJyA6ICcnKSArIGxpbmVcbiAgICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBhIGNodW5rIG9mIHRoZSBib2R5XG4gICovXG4gIF9lbWl0Qm9keSAoKSB7XG4gICAgdGhpcy5fYmFzZTY0RGVjb2RlQm9keUJ1ZmZlcigpXG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0IHx8ICF0aGlzLl9ib2R5QnVmZmVyKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9wcm9jZXNzRmxvd2VkVGV4dCgpXG4gICAgdGhpcy5jb250ZW50ID0gc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKVxuICAgIHRoaXMuX3Byb2Nlc3NIdG1sVGV4dCgpXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnXG4gIH1cblxuICBfcHJvY2Vzc0Zsb3dlZFRleHQgKCkge1xuICAgIGNvbnN0IGlzVGV4dCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNGbG93ZWQgPSAvXmZsb3dlZCQvaS50ZXN0KHBhdGhPcignJywgWydjb250ZW50VHlwZScsICdwYXJhbXMnLCAnZm9ybWF0J10pKHRoaXMpKVxuICAgIGlmICghaXNUZXh0IHx8ICFpc0Zsb3dlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWxTcCA9IC9eeWVzJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS5wYXJhbXMuZGVsc3ApXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9IHRoaXMuX2JvZHlCdWZmZXIuc3BsaXQoJ1xcbicpXG4gICAgICAucmVkdWNlKGZ1bmN0aW9uIChwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWUpIHtcbiAgICAgICAgLy8gcmVtb3ZlIHNvZnQgbGluZWJyZWFrcyBhZnRlciBzcGFjZSBzeW1ib2xzLlxuICAgICAgICAvLyBkZWxzcCBhZGRzIHNwYWNlcyB0byB0ZXh0IHRvIGJlIGFibGUgdG8gZm9sZCBpdC5cbiAgICAgICAgLy8gdGhlc2Ugc3BhY2VzIGNhbiBiZSByZW1vdmVkIG9uY2UgdGhlIHRleHQgaXMgdW5mb2xkZWRcbiAgICAgICAgY29uc3QgZW5kc1dpdGhTcGFjZSA9IC8gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICBjb25zdCBpc0JvdW5kYXJ5ID0gLyhefFxcbiktLSAkLy50ZXN0KHByZXZpb3VzVmFsdWUpXG4gICAgICAgIHJldHVybiAoZGVsU3AgPyBwcmV2aW91c1ZhbHVlLnJlcGxhY2UoL1sgXSskLywgJycpIDogcHJldmlvdXNWYWx1ZSkgKyAoKGVuZHNXaXRoU3BhY2UgJiYgIWlzQm91bmRhcnkpID8gJycgOiAnXFxuJykgKyBjdXJyZW50VmFsdWVcbiAgICAgIH0pXG4gICAgICAucmVwbGFjZSgvXiAvZ20sICcnKSAvLyByZW1vdmUgd2hpdGVzcGFjZSBzdHVmZmluZyBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNjc2I3NlY3Rpb24tNC40XG4gIH1cblxuICBfcHJvY2Vzc0h0bWxUZXh0ICgpIHtcbiAgICBjb25zdCBjb250ZW50RGlzcG9zaXRpb24gPSAodGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgdGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ11bMF0pIHx8IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgaXNIdG1sID0gL150ZXh0XFwvKHBsYWlufGh0bWwpJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSlcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAvXmF0dGFjaG1lbnQkL2kudGVzdChjb250ZW50RGlzcG9zaXRpb24udmFsdWUpXG4gICAgaWYgKGlzSHRtbCAmJiAhaXNBdHRhY2htZW50KSB7XG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiAvXnRleHRcXC9odG1sJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSkpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5fZGV0ZWN0SFRNTENoYXJzZXQodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gZGVjb2RlIFwiYmluYXJ5XCIgc3RyaW5nIHRvIGFuIHVuaWNvZGUgc3RyaW5nXG4gICAgICBpZiAoIS9edXRmWy1fXT84JC9pLnRlc3QodGhpcy5jaGFyc2V0KSkge1xuICAgICAgICB0aGlzLmNvbnRlbnQgPSBjb252ZXJ0KHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlciksIHRoaXMuY2hhcnNldCB8fCAnaXNvLTg4NTktMScpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcgJiYgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9PT0gJ2Jhc2U2NCcpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gdXRmOFN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gb3ZlcnJpZGUgY2hhcnNldCBmb3IgdGV4dCBub2Rlc1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldCA9ICd1dGYtOCdcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGV0ZWN0IGNoYXJzZXQgZnJvbSBhIGh0bWwgZmlsZVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaHRtbCBJbnB1dCBIVE1MXG4gICAqIEByZXR1cm5zIHtTdHJpbmd9IENoYXJzZXQgaWYgZm91bmQgb3IgdW5kZWZpbmVkXG4gICAqL1xuICBfZGV0ZWN0SFRNTENoYXJzZXQgKGh0bWwpIHtcbiAgICBsZXQgY2hhcnNldCwgaW5wdXRcblxuICAgIGh0bWwgPSBodG1sLnJlcGxhY2UoL1xccj9cXG58XFxyL2csICcgJylcbiAgICBsZXQgbWV0YSA9IGh0bWwubWF0Y2goLzxtZXRhXFxzK2h0dHAtZXF1aXY9W1wiJ1xcc10qY29udGVudC10eXBlW14+XSo/Pi9pKVxuICAgIGlmIChtZXRhKSB7XG4gICAgICBpbnB1dCA9IG1ldGFbMF1cbiAgICB9XG5cbiAgICBpZiAoaW5wdXQpIHtcbiAgICAgIGNoYXJzZXQgPSBpbnB1dC5tYXRjaCgvY2hhcnNldFxccz89XFxzPyhbYS16QS1aXFwtXzowLTldKik7Py8pXG4gICAgICBpZiAoY2hhcnNldCkge1xuICAgICAgICBjaGFyc2V0ID0gKGNoYXJzZXRbMV0gfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgbWV0YSA9IGh0bWwubWF0Y2goLzxtZXRhXFxzK2NoYXJzZXQ9W1wiJ1xcc10qKFteXCInPD4vXFxzXSspL2kpXG4gICAgaWYgKCFjaGFyc2V0ICYmIG1ldGEpIHtcbiAgICAgIGNoYXJzZXQgPSAobWV0YVsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhcnNldFxuICB9XG59XG5cbmNvbnN0IHN0cjJhcnIgPSBzdHIgPT4gbmV3IFVpbnQ4QXJyYXkoc3RyLnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyLmNoYXJDb2RlQXQoMCkpKVxuXG5jb25zdCB1dGY4U3RyMmFyciA9IHN0ciA9PiBuZXcgVGV4dEVuY29kZXIoJ3V0Zi04JykuZW5jb2RlKHN0cilcbiJdfQ==