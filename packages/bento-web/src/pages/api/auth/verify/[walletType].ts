import { Base64 } from '@bento/core/lib/utils/Base64';
import { StdSignDoc, serializeSignDoc } from '@cosmjs/amino';
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto';
import { verifyMessage } from '@ethersproject/wallet';
import { PublicKey } from '@solana/web3.js';
import Caver from 'caver-js';
import type { NextApiRequest, NextApiResponse } from 'next';
import nacl from 'tweetnacl';

export type WalletBalance = {
  walletAddress: string;
  address?: string;
  symbol: string;
  balance: number;
  price: number;
  logo?: string;
};

type APIRequest = NextApiRequest &
  (
    | {
        query: {
          walletType: 'web3' | 'kaikas' | 'phantom';
        };
        body: {
          walletAddress: string;
          signature: string;
          nonce: string;
        };
      }
    | {
        query: {
          walletType: 'keplr';
        };
        body: {
          walletAddress: string;
          signature: string;
          nonce: string;
          publicKeyValue: string;
        };
      }
  );

const caver = new Caver('https://public-node-api.klaytnapi.com/v1/cypress');

export default async (req: APIRequest, res: NextApiResponse) => {
  const { walletType } = req.query;
  const { walletAddress, signature, nonce, ...optionalParams } = req.body;

  let isValid: boolean = false;
  const signedMessage = Base64.decode(nonce);

  if (walletType === 'web3') {
    const recovered = verifyMessage(signedMessage, signature);
    isValid = recovered === walletAddress;
  } else if (walletType === 'keplr') {
    const secpSignature = Secp256k1Signature.fromFixedLength(
      new Uint8Array(Buffer.from(signature, 'base64')),
    );
    const rawSecp256k1Pubkey = new Uint8Array(
      Buffer.from(optionalParams.publicKeyValue, 'base64'),
    );

    const doc = makeADR36AminoSignDoc(walletAddress, signedMessage);
    const prehashed = sha256(serializeSignDoc(doc));

    isValid = await Secp256k1.verifySignature(
      secpSignature,
      prehashed,
      rawSecp256k1Pubkey,
    );
  } else if (walletType === 'kaikas') {
    const recovered = caver.utils.recover(
      signedMessage,
      caver.utils.decodeSignature(signature),
    );
    isValid = recovered === walletAddress;
  } else if (walletType === 'phantom') {
    const encodedMessage = new TextEncoder().encode(signedMessage);
    isValid = nacl.sign.detached.verify(
      new Uint8Array(encodedMessage),
      new Uint8Array(Buffer.from(signature, 'hex')),
      new PublicKey(walletAddress).toBytes(),
    );
  } else {
    return res.status(400).json({
      error: 'Invalid wallet type',
    });
  }

  if (!isValid) {
    return res.status(400).json({
      error: 'Invalid signature',
    });
  }

  return res.status(200).json({
    isValid,
  });
};

// https://github.com/chainapsis/keplr-wallet/blob/dd487d2a041e2a0ebff99b1cc633bc84a9eef916/packages/cosmos/src/adr-36/amino.ts#L87
function makeADR36AminoSignDoc(
  signer: string,
  data: string | Uint8Array,
): StdSignDoc {
  if (typeof data === 'string') {
    data = Buffer.from(data).toString('base64');
  } else {
    data = Buffer.from(data).toString('base64');
  }

  return {
    chain_id: '',
    account_number: '0',
    sequence: '0',
    fee: {
      gas: '0',
      amount: [],
    },
    msgs: [
      {
        type: 'sign/MsgSignData',
        value: {
          signer,
          data,
        },
      },
    ],
    memo: '',
  };
}