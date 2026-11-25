const {
  selectFields,
  parseFieldsParam,
  validateFields,
  applyFieldSelection,
  selectFieldsFromItem,
  getNestedValue,
  setNestedValue,
} = require('../../src/utils/selectFields');
const StellarKitError = require('../../src/utils/StellarKitError');

describe('selectFields utility', () => {
  describe('getNestedValue', () => {
    it('retrieves top-level values', () => {
      const obj = { name: 'Alice', age: 30 };
      expect(getNestedValue(obj, 'name')).toBe('Alice');
      expect(getNestedValue(obj, 'age')).toBe(30);
    });

    it('retrieves nested values with dot notation', () => {
      const obj = {
        user: {
          profile: {
            name: 'Bob'
          }
        }
      };
      expect(getNestedValue(obj, 'user.profile.name')).toBe('Bob');
    });

    it('returns undefined for non-existent paths', () => {
      const obj = { user: { name: 'Alice' } };
      expect(getNestedValue(obj, 'user.age')).toBeUndefined();
      expect(getNestedValue(obj, 'missing.path')).toBeUndefined();
    });

    it('handles null and undefined gracefully', () => {
      expect(getNestedValue(null, 'any.path')).toBeUndefined();
      expect(getNestedValue(undefined, 'any.path')).toBeUndefined();
    });
  });

  describe('setNestedValue', () => {
    it('sets top-level values', () => {
      const obj = {};
      setNestedValue(obj, 'name', 'Alice');
      expect(obj.name).toBe('Alice');
    });

    it('creates nested objects as needed', () => {
      const obj = {};
      setNestedValue(obj, 'user.profile.name', 'Bob');
      expect(obj).toEqual({
        user: {
          profile: {
            name: 'Bob'
          }
        }
      });
    });

    it('overwrites existing values', () => {
      const obj = { user: { name: 'Alice' } };
      setNestedValue(obj, 'user.name', 'Bob');
      expect(obj.user.name).toBe('Bob');
    });
  });

  describe('validateFields', () => {
    const allowedFields = ['id', 'hash', 'createdAt', 'asset', 'asset.code', 'asset.issuer'];

    it('passes validation for valid fields', () => {
      expect(() => {
        validateFields(['id', 'hash'], allowedFields);
      }).not.toThrow();
    });

    it('passes validation for nested fields', () => {
      expect(() => {
        validateFields(['asset.code', 'asset.issuer'], allowedFields);
      }).not.toThrow();
    });

    it('throws InvalidFields error for unknown fields', () => {
      expect(() => {
        validateFields(['id', 'unknown'], allowedFields);
      }).toThrow(StellarKitError);

      try {
        validateFields(['id', 'unknown', 'invalid'], allowedFields);
      } catch (err) {
        expect(err.type).toBe('InvalidFields');
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('unknown');
        expect(err.message).toContain('invalid');
      }
    });

    it('allows base field when nested path is requested', () => {
      expect(() => {
        validateFields(['asset.code'], allowedFields);
      }).not.toThrow();
    });
  });

  describe('selectFieldsFromItem', () => {
    it('selects top-level fields', () => {
      const item = { id: '1', hash: 'abc', ledger: 100, createdAt: '2024-01-01' };
      const result = selectFieldsFromItem(item, ['id', 'hash']);
      expect(result).toEqual({ id: '1', hash: 'abc' });
    });

    it('selects nested fields with dot notation', () => {
      const item = {
        id: '1',
        asset: { code: 'USDC', issuer: 'GABC123', type: 'credit_alphanum4' }
      };
      const result = selectFieldsFromItem(item, ['id', 'asset.code']);
      expect(result).toEqual({
        id: '1',
        asset: { code: 'USDC' }
      });
    });

    it('handles multiple nested fields from same object', () => {
      const item = {
        id: '1',
        asset: { code: 'USDC', issuer: 'GABC123', type: 'credit_alphanum4' }
      };
      const result = selectFieldsFromItem(item, ['asset.code', 'asset.issuer']);
      expect(result).toEqual({
        asset: { code: 'USDC', issuer: 'GABC123' }
      });
    });

    it('returns empty object if no fields match', () => {
      const item = { id: '1', hash: 'abc' };
      const result = selectFieldsFromItem(item, ['nonexistent']);
      expect(result).toEqual({});
    });

    it('handles null and undefined items', () => {
      expect(selectFieldsFromItem(null, ['id'])).toBeNull();
      expect(selectFieldsFromItem(undefined, ['id'])).toBeUndefined();
    });
  });

  describe('applyFieldSelection', () => {
    it('applies selection to array of items', () => {
      const data = [
        { id: '1', hash: 'abc', ledger: 100 },
        { id: '2', hash: 'def', ledger: 101 }
      ];
      const result = applyFieldSelection(data, ['id', 'hash']);
      expect(result).toEqual([
        { id: '1', hash: 'abc' },
        { id: '2', hash: 'def' }
      ]);
    });

    it('applies selection to single object', () => {
      const data = { id: '1', hash: 'abc', ledger: 100 };
      const result = applyFieldSelection(data, ['id', 'hash']);
      expect(result).toEqual({ id: '1', hash: 'abc' });
    });

    it('handles empty arrays', () => {
      const result = applyFieldSelection([], ['id']);
      expect(result).toEqual([]);
    });
  });

  describe('parseFieldsParam', () => {
    const allowedFields = ['id', 'hash', 'createdAt', 'amount'];

    it('returns null when fields param is undefined', () => {
      expect(parseFieldsParam(undefined, allowedFields)).toBeNull();
    });

    it('returns null when fields param is null', () => {
      expect(parseFieldsParam(null, allowedFields)).toBeNull();
    });

    it('throws error for empty string', () => {
      expect(() => {
        parseFieldsParam('', allowedFields);
      }).toThrow(StellarKitError);

      try {
        parseFieldsParam('', allowedFields);
      } catch (err) {
        expect(err.type).toBe('InvalidFields');
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('cannot be empty');
      }
    });

    it('throws error for whitespace-only string', () => {
      expect(() => {
        parseFieldsParam('   ', allowedFields);
      }).toThrow(StellarKitError);
    });

    it('parses comma-separated fields', () => {
      const result = parseFieldsParam('id,hash,createdAt', allowedFields);
      expect(result).toEqual(['id', 'hash', 'createdAt']);
    });

    it('trims whitespace around field names', () => {
      const result = parseFieldsParam(' id , hash , createdAt ', allowedFields);
      expect(result).toEqual(['id', 'hash', 'createdAt']);
    });

    it('validates fields against allow-list', () => {
      expect(() => {
        parseFieldsParam('id,invalid,hash', allowedFields);
      }).toThrow(StellarKitError);
    });

    it('handles single field', () => {
      const result = parseFieldsParam('id', allowedFields);
      expect(result).toEqual(['id']);
    });
  });

  describe('selectFields (main function)', () => {
    const allowedFields = ['id', 'hash', 'createdAt', 'asset.code', 'asset.issuer'];

    it('returns data unchanged when fields param is undefined', () => {
      const data = { data: [{ id: '1', hash: 'abc' }] };
      const result = selectFields(data, undefined, allowedFields);
      expect(result).toEqual(data);
    });

    it('applies field selection when fields param is provided', () => {
      const data = {
        data: [
          { id: '1', hash: 'abc', ledger: 100, createdAt: '2024-01-01' }
        ]
      };
      const result = selectFields(data, 'id,hash', allowedFields);
      expect(result).toEqual({
        data: [
          { id: '1', hash: 'abc' }
        ]
      });
    });

    it('preserves meta and other top-level properties', () => {
      const data = {
        meta: { count: 1, hasMore: false },
        data: [{ id: '1', hash: 'abc', ledger: 100 }]
      };
      const result = selectFields(data, 'id', allowedFields);
      expect(result.meta).toEqual({ count: 1, hasMore: false });
      expect(result.data).toEqual([{ id: '1' }]);
    });

    it('handles nested field selection', () => {
      const data = {
        data: [
          {
            id: '1',
            asset: { code: 'USDC', issuer: 'GABC123', type: 'credit_alphanum4' }
          }
        ]
      };
      const result = selectFields(data, 'id,asset.code', allowedFields);
      expect(result).toEqual({
        data: [
          {
            id: '1',
            asset: { code: 'USDC' }
          }
        ]
      });
    });

    it('throws error for invalid fields', () => {
      const data = { data: [{ id: '1' }] };
      expect(() => {
        selectFields(data, 'invalid', allowedFields);
      }).toThrow(StellarKitError);
    });

    it('throws error for empty fields parameter', () => {
      const data = { data: [{ id: '1' }] };
      expect(() => {
        selectFields(data, '', allowedFields);
      }).toThrow(StellarKitError);
    });

    it('handles data not wrapped in data property', () => {
      const data = [{ id: '1', hash: 'abc', ledger: 100 }];
      const result = selectFields(data, 'id,hash', allowedFields);
      expect(result).toEqual([{ id: '1', hash: 'abc' }]);
    });
  });

  describe('Integration scenarios', () => {
    it('handles transactions with nested fee objects', () => {
      const allowedFields = ['id', 'hash', 'fee.charged', 'fee.chargedInXLM'];
      const data = {
        data: [
          {
            id: 'tx1',
            hash: 'abc123',
            fee: {
              charged: '100',
              chargedInXLM: '0.0000100',
              max: '1000',
              maxInXLM: '0.0001000'
            }
          }
        ]
      };

      const result = selectFields(data, 'id,fee.charged', allowedFields);
      expect(result).toEqual({
        data: [
          {
            id: 'tx1',
            fee: { charged: '100' }
          }
        ]
      });
    });

    it('handles payments with asset filtering', () => {
      const allowedFields = ['paymentId', 'from', 'to', 'asset.code', 'asset.issuer', 'amount'];
      const data = {
        data: [
          {
            paymentId: 'p1',
            from: 'GABC',
            to: 'GDEF',
            asset: { code: 'USDC', issuer: 'GXYZ', type: 'credit_alphanum4' },
            amount: '100.0000000',
            transactionHash: 'tx123'
          }
        ]
      };

      const result = selectFields(data, 'from,to,amount', allowedFields);
      expect(result).toEqual({
        data: [
          {
            from: 'GABC',
            to: 'GDEF',
            amount: '100.0000000'
          }
        ]
      });
    });

    it('handles trades with multiple nested objects', () => {
      const allowedFields = [
        'id',
        'baseAsset.code',
        'baseAsset.issuer',
        'counterAsset.code',
        'counterAsset.issuer',
        'baseAmount',
        'counterAmount',
        'price'
      ];

      const data = {
        data: [
          {
            id: 't1',
            baseAsset: { code: 'XLM', issuer: null, type: 'native' },
            counterAsset: { code: 'USDC', issuer: 'GABC', type: 'credit_alphanum4' },
            baseAmount: '1000.0000000',
            counterAmount: '100.0000000',
            price: '0.1000000',
            ledger: 12345
          }
        ]
      };

      const result = selectFields(data, 'baseAsset.code,counterAsset.code,price', allowedFields);
      expect(result).toEqual({
        data: [
          {
            baseAsset: { code: 'XLM' },
            counterAsset: { code: 'USDC' },
            price: '0.1000000'
          }
        ]
      });
    });
  });
});
