import { Observable } from 'rxjs';
import moment from 'moment';

import { FormatFn } from '../types/exchanges';
import { debugError, makeTimeChunks } from '.';
import timePeriods from './timePeriods';
import { fetchCandles$ } from '../observables';
import { TradingPair } from '../types';

export type FetchCandlesOptions<T> = {
  makeCandlesUrlFn: (...args: any) => string;
  makeChunks?: boolean;
  apiLimit?: number;
  debug?: {
    exchangeName: string;
    isDebug: boolean;
  };
  isUdf: boolean;
  formatFn: FormatFn<T>;
  requestOptions?: { [key: string]: string | number };
};

const makeChunkCalls = <T>(
  pair: TradingPair,
  interval: string,
  start: number,
  end: number,
  opts: FetchCandlesOptions<T>
): Observable<T>[] => {
  const {
    makeCandlesUrlFn,
    requestOptions,
    makeChunks,
    apiLimit,
    debug,
  } = opts;

  if (!makeChunks) {
    return [
      fetchCandles$<T>(
        makeCandlesUrlFn(pair, interval, start, end),
        requestOptions
      ),
    ];
  }

  const limit = apiLimit || 1000;

  const timePeriod = timePeriods[interval.slice(-1)];

  const unixInterval = moment
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .duration(Number(interval.slice(0, interval.length - 1)), timePeriod)
    .asMilliseconds();

  const chunksSize = Math.ceil(limit * unixInterval);

  const timeIntervalChunks = makeTimeChunks(start, end, chunksSize);

  return timeIntervalChunks
    .map((chunk) => {
      try {
        return makeCandlesUrlFn(pair, interval, chunk.fromTime, chunk.toTime);
      } catch (e) {
        return debugError(e.message, debug?.isDebug);
      }
    })
    .map((url) => fetchCandles$(url, requestOptions));
};

export default makeChunkCalls;
