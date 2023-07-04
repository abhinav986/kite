
export const firstCandleCrossBothSide = (candles) => {
    let lowHit = false;
    let highHit = false;
    let highCandle;
    let lowCandle;
    let direction;
    let engulfeUp = false;
    let engulfeDown = false;
    let hit = false;
    let buyOrSellPrice;
    let stopLoss = 0;
    let inProgress = false;
    let stoplossPriceDown = 0;
    let stoplossPriceUp = 0;
    candles.forEach((val, index) => {
        if (candles[0].high < val.high) {
            highHit = true;
            if (lowHit && !direction) {
                direction = 'up';
                highCandle = { high: val.high, low: val.low };
            }
        }
        if (candles[0].low > val.low) {
            lowHit = true;
            if (highHit && !direction) {
                direction = 'down';
                lowCandle = { high: val.high, low: val.low };
            }
        }
        if (direction && !hit) {
            if (direction === 'up' && val.high > highCandle.high && !engulfeUp) {
                highCandle = { high: val.high, low: val.low };
            }
            if (direction === 'down' && val.low < lowCandle.low && !engulfeDown) {
                lowCandle = { high: val.high, low: val.low };
            }

            if (direction === 'up' && highCandle.low > val.low && !hit) {
                engulfeUp = true;
                inProgress = true;
                stoplossPriceUp = val.low;
            }
            if (direction === 'down' && lowCandle.high < val.high && !hit) {
                engulfeDown = true;
                inProgress = true;
                stoplossPriceDown = val.high;
            }

            if (engulfeUp && highCandle.high < val.high && index < 21) {
                hit = true;
                buyOrSellPrice = highCandle.high;
            }
            if (engulfeDown && lowCandle.low > val.low && index < 21) {
                hit = true;
                buyOrSellPrice = lowCandle.low;
            }
        }
        if(hit) {
            if (direction === 'up' && val.low < stoplossPriceUp) {
                stopLoss = stoplossPriceUp;
            } else if (direction === 'down' && val.high > stoplossPriceDown) {
                stopLoss = stoplossPriceDown;
            }
        }
    });
    const target = direction === 'up' ? stopLoss || candles[candles.length - 1].high : stopLoss || candles[candles.length - 1]?.low;
    return {
        buyOrSellPrice: buyOrSellPrice,
        target: target,
        inProgress: inProgress,
        profitOrLoss: direction === 'up' ? Math.floor(target - buyOrSellPrice) : Math.floor(buyOrSellPrice - target),
        direction: direction,
        // match: match,
        time: candles[0].date,
        hit: hit,
    };
}

export const engulfe = (candles) => {
    let upCrossArr = [];
    let lowCrossArr = [];
    let engulfeUp = false;
    let engulfeDown = false;
    let upFirstCross;
    let lowFirstCross;
    let hit = false;
    let buyOrSellPrice;
    let stopLoss = 0;
    let direction;
    let inProgress = false;
    let stoplossPriceDown = 0;
    let stoplossPriceUp = 0;

    candles.forEach((val, index) => {
        if (!upCrossArr.length && !lowCrossArr.length) {
            upCrossArr.push({ high: val.high, low: val.low });
            lowCrossArr.push({ high: val.high, low: val.low });
        } else {
            if (!hit) {
                if (upCrossArr[upCrossArr.length - 1].high < val.high && !engulfeUp) {
                    if (upCrossArr[upCrossArr.length - 1].low > val.low) {
                        upCrossArr.pop();
                    }
                    upCrossArr.push({ high: val.high, low: val.low });
                } else if (lowCrossArr[lowCrossArr.length - 1].low > val.low && !engulfeDown) {
                    if (lowCrossArr[lowCrossArr.length - 1].high < val.high) {
                        lowCrossArr.pop();
                    }
                    lowCrossArr.push({ high: val.high, low: val.low });
                }

                if (upCrossArr.length >= 2 && upCrossArr[upCrossArr.length - 2].low > val.low && !hit) {
                    engulfeUp = true;
                    stoplossPriceUp = val.low;
                } else if (lowCrossArr.length >= 2 && lowCrossArr[lowCrossArr.length - 2].high < val.high && !hit) {
                    engulfeDown = true;
                    stoplossPriceDown = val.high;
                }

                if (engulfeUp && !upFirstCross) {
                    if (upCrossArr[upCrossArr.length - 1].high < val.high) {
                        upFirstCross = val.high;
                        inProgress = true;
                    }
                }
                if (engulfeDown && !lowFirstCross) {
                    if (lowCrossArr[lowCrossArr.length - 1].low > val.low) {
                        lowFirstCross = val.low;
                        inProgress = true;
                    }
                }

                if (upFirstCross && upFirstCross < val.high && index < 21 && !hit) {
                    hit = true;
                    buyOrSellPrice = upFirstCross;
                    direction = 'up';
                }
                if (lowFirstCross && lowFirstCross > val.low && index < 21  && !hit) {
                    hit = true;
                    buyOrSellPrice = lowFirstCross;
                    direction = 'down'
                }
            } else {
                if (direction === 'up' && val.low < stoplossPriceUp) {
                    stopLoss = stoplossPriceUp;
                } else if (direction === 'down' && val.high > stoplossPriceDown) {
                    stopLoss = stoplossPriceDown;
                }
            }
        }
    })
    const target = direction === 'up' ? stopLoss || candles[candles.length - 1].high : stopLoss || candles[candles.length - 1]?.low;
    return {
        buyOrSellPrice: buyOrSellPrice,
        target: target,
        profitOrLoss: direction === 'up' ? Math.floor(target - buyOrSellPrice) : Math.floor(buyOrSellPrice - target),
        direction: direction,
        // match: match,
        time: candles[0].date,
        hit: hit,
        inProgress: inProgress,
    };
}

export const fourInsideOne = (candles) => {
    let match = [];
    let direction;
    let hit = false;
    let buyOrSellPrice = 0;
    let stopLoss = 0;
    let inProgress = false;
    let isSucess = true;
    candles.forEach((val, index) => {
        if (match.length === 0) {
            match.push(val);
        } else {
            if (match[0].high > val.high && match[0].low < val.low && isSucess) {
                if (match.length !== 5) {
                    match.push(val);
                }
            } else {
                if (match.length !== 5 && isSucess) {
                    match = [];
                    isSucess = false;
                }
            }
        }
        if (match.length === 5) {
            inProgress = true;
            if (match[0].high < val.high && !hit) {
                direction = 'up';
                hit = true;
                buyOrSellPrice = match[0].high;
            } else if (match[0].low > val.low && !hit) {
                direction = 'low';
                hit = true;
                buyOrSellPrice = match[0].low;
            }
        }
        if (hit) {
            if (direction === 'up' && match[0].low > val.low) {
                stopLoss = match[0].low;
            } else if (direction === 'low' && match[0].high < val.high) {
                stopLoss = match[0].high;
            }
        }
    });

    const target = direction === 'up' ? (stopLoss || candles[candles.length - 1].high) : (stopLoss || candles[candles.length - 1]?.low);
    return {
        buyOrSellPrice: buyOrSellPrice,
        target: target,
        profitOrLoss: direction === 'up' ? Math.floor(target - buyOrSellPrice) : Math.floor(buyOrSellPrice - target),
        direction: direction,
        // match: match,
        time: match[0]?.date,
        hit: hit,
        inProgress: inProgress,
    };
}

export const firstCross = (candles) => {
    let upCrossArr = [];
    let lowCrossArr = [];
    let engulfeUp = false;
    let engulfeDown = false;
    let upFirstCross;
    let lowFirstCross;
    let hit = false;
    let buyOrSellPrice;
    let stopLoss = 0;
    let direction;
    let inProgress = false;
    let stoplossPriceDown = 0;
    let stoplossPriceUp = 0;
    candles.forEach((val) => {
        if (!upCrossArr.length && !lowCrossArr.length) {
            upCrossArr.push({ high: val.high, low: val.low });
            lowCrossArr.push({ high: val.high, low: val.low });
        } else {
            if (!hit) {
                if (upCrossArr[upCrossArr.length - 1]?.high < val.high && !engulfeUp) {
                    upCrossArr.push({ high: val.high, low: val.low });
                } else if (lowCrossArr[lowCrossArr.length - 1]?.low > val.low && !engulfeDown) {
                    lowCrossArr.push({ high: val.high, low: val.low });
                }

                if (upCrossArr.length >= 2 && upCrossArr[upCrossArr.length - 1].low > val.low && !hit) {
                    engulfeUp = true;
                    stoplossPriceUp = val.low;
                } else if (lowCrossArr.length >= 2 && lowCrossArr[lowCrossArr.length - 1].high < val.high && !hit) {
                    engulfeDown = true;
                    stoplossPriceDown = val.high;
                }

                if (engulfeUp && !upFirstCross) {
                    if (upCrossArr[upCrossArr.length - 1].high < val.high) {
                        upFirstCross = val.high;
                        inProgress = true;
                    }
                }
                if (engulfeDown && !lowFirstCross) {
                    if (lowCrossArr[lowCrossArr.length - 1].low > val.low) {
                        lowFirstCross = val.low;
                        inProgress = true;
                    }
                }

                if (upFirstCross && upFirstCross < val.high && !hit) {
                    hit = true;
                    buyOrSellPrice = upFirstCross;
                    direction = 'up';
                }
                if (lowFirstCross && lowFirstCross > val.low && !hit) {
                    hit = true;
                    buyOrSellPrice = lowFirstCross;
                    direction = 'down'
                }
            } else {
                if (direction === 'up' && val.low < stoplossPriceUp) {
                    stopLoss = stoplossPriceUp;
                } else if (direction === 'down' && val.high > stoplossPriceDown) {
                    stopLoss = stoplossPriceDown;
                }
            }
        }
    })
    const target = direction === 'up' ? stopLoss || candles[candles.length - 1].high : stopLoss || candles[candles.length - 1]?.low;
    return {
        buyOrSellPrice: buyOrSellPrice,
        target: target,
        profitOrLoss: direction === 'up' ? Math.floor(target - buyOrSellPrice) : Math.floor(buyOrSellPrice - target),
        direction: direction,
        // match: match,
        time: candles[0].date,
        hit: hit,
        inProgress: inProgress,
    };
}

export const gapOpen = (candles, lasDayCandles) => {
    const { lastDayHigh, lastDayLow } = getHighAndLow(lasDayCandles);
    if (lastDayHigh < candles[0]?.open || lastDayLow > candles[0]?.open) {
        let result = firstCross(candles);
        return result;
    }
    return { hit: false, inProgress: false };
}

const getHighAndLow = (candles) => {
    let high = 0;
    let low = 0;
    candles.forEach((val) => {
        if (high < val.high) {
            high = val.high;
        } else if (low > val.low) {
            low = low;
        }
    });
    return { lastDayHigh: high, lastDayLow: low };
}
