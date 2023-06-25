
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
    candles.forEach((val, index) => {
        if(candles[0].high < val.high) {
            highHit = true;
            if(lowHit && !direction) {
                direction = 'up';
                highCandle = {high: val.high, low: val.low};
            }
        }
        if(candles[0].low > val.low) {
            lowHit = true;
            if(highHit && !direction) {
                direction = 'down';
                lowCandle = {high: val.high, low: val.low};
            }
        }
        if (direction && !hit) {
            if(direction === 'up' && val.high > highCandle.high && !engulfeUp) {
                highCandle = {high: val.high, low: val.low};
            }
            if(direction === 'down' && val.low < lowCandle.low && !engulfeDown) {
                lowCandle = {high: val.high, low: val.low};
            }

            if(direction === 'up' && highCandle.low > val.low) {
                engulfeUp = true;
                inProgress = true;
            }
            if(direction === 'down' && lowCandle.high < val.high) {
                engulfeDown = true;
                inProgress = true;
                console.log("here");
            }

            if(engulfeUp && highCandle.high < val.high && index < 21) {
                hit = true;
                buyOrSellPrice = highCandle.high;
            }
            if(engulfeDown && lowCandle.low > val.low && index < 21) {
                hit = true;
                buyOrSellPrice = lowCandle.low;
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

    candles.forEach((val, index) => {
        if (!upCrossArr.length && !lowCrossArr.length) {
            upCrossArr.push({ high: val.high, low: val.low });
            lowCrossArr.push({ high: val.high, low: val.low });
        } else {
            if (!hit) {
                if (upCrossArr[upCrossArr.length - 1].high < val.high && !engulfeUp) {
                    if(upCrossArr[upCrossArr.length - 1].low > val.low) {
                        upCrossArr.pop();
                    }
                    upCrossArr.push({ high: val.high, low: val.low });
                } else if (lowCrossArr[lowCrossArr.length - 1].low > val.low && !engulfeDown) {
                    if(lowCrossArr[lowCrossArr.length - 1].high < val.high) {
                        lowCrossArr.pop();
                    }
                    lowCrossArr.push({ high: val.high, low: val.low });
                }

                if (upCrossArr.length >= 2 && upCrossArr[upCrossArr.length - 2].low > val.low) {
                    engulfeUp = true;
                } else if (lowCrossArr.length >= 2 && lowCrossArr[lowCrossArr.length - 2].high < val.high) {
                    engulfeDown = true;
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

                if (upFirstCross && upFirstCross < val.high && index < 21) {
                    hit = true;
                    buyOrSellPrice = upFirstCross;
                    direction = 'up';
                }
                if (lowFirstCross && lowFirstCross > val.low && index < 21) {
                    hit = true;
                    buyOrSellPrice = lowFirstCross;
                    direction = 'down'
                }
            } else {
                if (direction === 'up' && val.low < lowCrossArr[lowCrossArr.length - 1].low) {
                    stopLoss = lowCrossArr[lowCrossArr.length - 1].low;
                } else if (direction === 'down' && val.high > upCrossArr[upCrossArr.length - 1].high) {
                    stopLoss = upCrossArr[upCrossArr.length - 1].high;
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
    let lowHit = 0;
    let upperHit = 0;
    let direction;
    let hit = false;
    let buyOrSellPrice = 0;
    let previousLow = 0;
    let previousHigh = 0;
    let stopLoss = 0;
    let inProgress = false;
    candles.forEach((val) => {
        if (match.length === 0) {
            match.push(val);
        } else {
            if (match[0].high > val.high && match[0].low < val.low) {
                if (match.length !== 5) {
                    match.push(val);
                }
            } else {
                if (match.length !== 5) {
                    match = [];
                    match.push(val);
                }
            }
        }
        if (match.length === 5) {
            if (lowHit !== 2 && upperHit !== 2) {
                if ((previousHigh || match[0].high) < val.high) {
                    if (upperHit === 1 && lowHit === 0) {
                        direction = 'up';
                        hit = true;
                        buyOrSellPrice = previousHigh;
                    }
                    previousHigh = val.high;
                    upperHit = upperHit + 1;
                    inProgress = true;
                } else if ((previousLow || match[0].low) > val.low) {
                    if (lowHit === 1 && upperHit === 0) {
                        direction = 'low';
                        hit = true;
                        buyOrSellPrice = previousLow;
                    }
                    previousLow = val.low;
                    lowHit = lowHit + 1;
                    inProgress = true;
                }
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

    const target = direction === 'up' ? stopLoss || candles[candles.length - 1].high : stopLoss || candles[candles.length - 1]?.low;
    return {
        buyOrSellPrice: buyOrSellPrice,
        target: target,
        profitOrLoss: direction === 'up' ? Math.floor(target - buyOrSellPrice) : Math.floor(buyOrSellPrice - target),
        direction: direction,
        // match: match,
        time: match[0].date,
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

                if (upCrossArr.length >= 2 && upCrossArr[upCrossArr.length - 1].low > val.low) {
                    engulfeUp = true;
                } else if (lowCrossArr.length >= 2 && lowCrossArr[lowCrossArr.length - 1].high < val.high) {
                    engulfeDown = true;
                }

                //empty array if candle crossed it
                // if (upCrossArr[0]?.low > val.low) {
                //     upCrossArr = [{ high: val.high, low: val.low }];
                //     engulfeUp = false;
                //     upFirstCross = undefined;
                // }
                // if (lowCrossArr[0]?.high < val.high) {
                //     lowCrossArr = [{ high: val.high, low: val.low }];
                //     engulfeDown = false;
                //     lowFirstCross = undefined;
                // }

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

                if (upFirstCross && upFirstCross < val.high) {
                    hit = true;
                    buyOrSellPrice = upFirstCross;
                    direction = 'up';
                }
                if (lowFirstCross && lowFirstCross > val.low) {
                    hit = true;
                    buyOrSellPrice = lowFirstCross;
                    direction = 'down'
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
