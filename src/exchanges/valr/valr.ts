import _omit from 'lodash/omit';
import { Subject, merge, from, timer } from 'rxjs';
import { map, multicast, takeUntil, filter, switchMap } from 'rxjs/operators';
import moment from 'moment';

import { VALR } from '../../const';
import {
  debugError,
  fetchCandles,
  updateCandles,
  makeOptions,
  makeCandlesRestApiUrl,
  addChannelToCandlesData,
  makeChannelFromDataStream,
  mapToStandardInterval,
} from '../../utils';
import { formatter, makePair } from './utils';
import {
  IExchange,
  ClientError,
  Options,
  ClientOptions,
  PairConf,
  TokensSymbols,
  StreamData,
  Candle,
} from '../../types';
import {
  WS_ROOT_URL,
  REST_ROOT_URL,
  API_RESOLUTIONS_MAP,
  makeCustomApiUrl,
} from './const';
import { ValrCandle } from './types';
import BaseExchange from '../base/baseExchange';
import { filterNullish } from '../../observables';

class Valr extends BaseExchange implements IExchange<ValrCandle> {
  constructor() {
    super({
      wsRootUrl: WS_ROOT_URL,
      restRootUrl: REST_ROOT_URL,
      exchangeName: VALR,
      apiResolutionsMap: API_RESOLUTIONS_MAP,
      makeCustomApiUrl,
    });

    this._options = { format: formatter.tradingview };
  }

  _options!: ClientOptions<ValrCandle>;

  start = (opts: Options = { format: 'tradingview' }): undefined | string => {
    if (this._status.isRunning) {
      return debugError(ClientError.SERVICE_IS_RUNNING, this._status.isDebug);
    }

    this._options = makeOptions<ValrCandle>(opts, formatter);

    timer(0, 5000)
      .pipe(
        switchMap(() => {
          const fecthFn = Object.keys(this._tradingPairs).map((channel) => {
            const { symbols, interval } = this._tradingPairs[channel];
            const start = moment().subtract(5, 'minute').valueOf();
            const end = moment().valueOf();

            const candlesApiCall = this.fetchCandles(
              symbols,
              interval,
              start,
              end
            );

            return from(candlesApiCall).pipe<Candle[], StreamData<Candle>>(
              filter((data) => !!data),
              map((streamData) => [symbols, streamData[0], interval])
            );
          });

          return merge(...fecthFn).pipe(
            map((streamData) =>
              mapToStandardInterval<Candle>(streamData, this.options.intervals)
            ),
            filterNullish(),
            map((streamData) => {
              this._candlesData = addChannelToCandlesData<Candle>(
                this._candlesData,
                streamData
              );

              return streamData;
            }),
            filterNullish(),
            map((ticker) => {
              const channel = makeChannelFromDataStream(ticker);

              this._candlesData = updateCandles<Candle, ValrCandle>(
                ticker,
                this._candlesData,
                this._options.format,
                this._status.isDebug
              );

              if (this._candlesData[channel].meta.isNewCandle) {
                this._dataStream$.next(this._candlesData);
              }

              return this._candlesData;
            })
          );
        }),
        takeUntil(this._closeStream$),
        multicast(() => new Subject())
      )
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      .connect();

    this._status.isRunning = true;

    return undefined;
  };

  stop = (): void => {
    this._resetInstance();

    this._status.isRunning = false;
  };

  fetchCandles = async (
    pair: TokensSymbols,
    interval: string,
    start: number,
    end: number
  ): Promise<Candle[]> => {
    const makeCandlesUrlFn = (
      symbols: TokensSymbols,
      timeInterval: string,
      startTime: number,
      endTime: number
    ) =>
      makeCandlesRestApiUrl(
        this._exchangeConf.exchangeName,
        this._exchangeConf.restRootUrl,
        {
          pair: makePair(symbols[0], symbols[1]),
          periodSeconds: this.options.intervals[timeInterval] as string,
          startTime: Math.ceil(startTime / 1000),
          endTime: Math.ceil(endTime / 1000),
        }
      );

    return fetchCandles<ValrCandle>(pair, interval, start, end, {
      formatFn: this._options.format,
      makeChunks: true,
      apiLimit: 300,
      debug: {
        exchangeName: this._exchangeConf.exchangeName,
        isDebug: this._status.isDebug,
      },
      makeCandlesUrlFn,
    });
  };

  addTradingPair = (
    pair: TokensSymbols,
    pairConf: PairConf
  ): string | undefined => {
    try {
      this._addTradingPair(pair, pairConf);

      return undefined;
    } catch (err) {
      if (err instanceof Error) {
        return err.message;
      }
    }
  };

  removeTradingPair = (
    pair: TokensSymbols,
    intervalApi: string
  ): string | undefined => {
    try {
      this._removeTradingPair(pair, intervalApi);
    } catch (err) {
      if (err instanceof Error) {
        return err.message;
      }
    }

    return undefined;
  };
}

export default Valr;
