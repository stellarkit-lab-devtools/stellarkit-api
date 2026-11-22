/**
 * This file contains deliberately wrong type assertions to verify that
 * the type checker actually fails when types break.
 *
 * When this file is run through tsd, it should FAIL, proving that the
 * type checking is working correctly.
 */

import { expectType } from 'tsd';
import { StellarKitClient } from '../../stellarkit-client';
import type { AccountResponse } from '../../../types/index.d';

const client = new StellarKitClient({ baseUrl: 'https://api.stellarkit.io' });

// This should fail: getAccount returns Promise<AccountResponse['data']>, not string
expectType<string>(client.getAccount('GABC...'));

// This should fail: AccountResponse.data.id is string, not number
declare const accountResponse: AccountResponse;
expectType<number>(accountResponse.data.id);
