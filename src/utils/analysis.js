
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

export const engulfe = (candles, previousDayCandles) => {
    let lastFiveCandle = previousDayCandles?.slice(19, 24);
    const { lastDayHigh, lastDayLow } = getHighAndLow(lastFiveCandle);
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
    let isSucess = true;

    candles.forEach((val, index) => {
        if (!upCrossArr.length && !lowCrossArr.length) {
            upCrossArr.push({ high: val.high, low: val.low });
            lowCrossArr.push({ high: val.high, low: val.low });
        } else {
            if (!hit && isSucess) {
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
                    if(((upCrossArr[upCrossArr.length - 1].high - lastDayLow)/upCrossArr[upCrossArr.length - 1].high)*100 > 1.75) {
                        isSucess = false;
                    }
                } else if (lowCrossArr.length >= 2 && lowCrossArr[lowCrossArr.length - 2].high < val.high && !hit) {
                    engulfeDown = true;
                    stoplossPriceDown = val.high;
                    if(((lastDayHigh - lowCrossArr[lowCrossArr.length - 1].low)/lowCrossArr[lowCrossArr.length - 1].low)*100 > 1.75) {
                        isSucess = false;
                    }
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

export const fourInsideOne = (candles, previousDayCandles) => {
    let lastFiveCandle = previousDayCandles?.slice(19, 24);
    const { lastDayHigh, lastDayLow } = getHighAndLow(lastFiveCandle);
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
        } else if(isSucess) {
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
        if (match.length === 5 && index < 20) {
            inProgress = true;
            if (match[0].high < val.high && !hit) {
                if(((match[0]?.high - lastDayLow)/match[0]?.high)*100 > 1.75) {
                    isSucess = false;
                } else {
                    direction = 'up';
                    hit = true;
                    buyOrSellPrice = match[0].high;
                }
            } else if (match[0].low > val.low && !hit) {
                if(((lastDayHigh - match[0]?.low)/match[0]?.low)*100 > 1.75) {
                    isSucess = false;
                } else {
                    direction = 'low';
                    hit = true;
                    buyOrSellPrice = match[0].low;
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

export const firstCross = (candles, previousDayCandles) => {
    let lastFiveCandle = previousDayCandles?.slice(19, 25);
    const { lastDayHigh, lastDayLow } = getHighAndLow(lastFiveCandle);
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
    let isSucess = true;
    candles.forEach((val, index) => {
        if (!upCrossArr.length && !lowCrossArr.length) {
            upCrossArr.push({ high: val.high, low: val.low });
            lowCrossArr.push({ high: val.high, low: val.low });
        } else {
            if (!hit && isSucess && index < 16) {
                if (upCrossArr[upCrossArr.length - 1]?.high < val.high && !engulfeUp) {
                    upCrossArr.push({ high: val.high, low: val.low });
                } else if (lowCrossArr[lowCrossArr.length - 1]?.low > val.low && !engulfeDown) {
                    lowCrossArr.push({ high: val.high, low: val.low });
                }

                if (upCrossArr.length >= 2 && upCrossArr[upCrossArr.length - 1].low > val.low && !hit && !upFirstCross) {
                    upFirstCross = val;
                    console.log(lastFiveCandle);
                    console.log(val);
                    if(((upCrossArr[upCrossArr.length - 1].high - lastDayLow)/upCrossArr[upCrossArr.length - 1].high)*100 > 1.75) {
                        isSucess = false;
                    }
                } else if (lowCrossArr.length >= 2 && lowCrossArr[lowCrossArr.length - 1].high < val.high && !hit && !lowFirstCross) {
                    if(((lastDayHigh - lowCrossArr[lowCrossArr.length - 1].low)/lowCrossArr[lowCrossArr.length - 1].low)*100 > 1.75) {
                        isSucess = false;
                    }
                    lowFirstCross = val;
                }

                //remove first cross if val paased that without making 2 cross
                // if(upFirstCross && !engulfeUp && val.high >= upCrossArr[upCrossArr.length - 1].high) {
                //     upFirstCross = undefined;
                // } else if(lowFirstCross && !engulfeDown && val.low <= lowCrossArr[lowCrossArr.length -1].low){
                //     lowFirstCross = undefined;
                // }
                if(upFirstCross && upFirstCross.low > val.low) {
                    engulfeUp = true;
                    stoplossPriceUp = val.low;
                    inProgress = true;
                    if(upCrossArr[0].low > val.low) {
                        isSucess = false;
                    }
                } else if(lowFirstCross && lowFirstCross.high < val.high) {
                    engulfeDown = true;
                    stoplossPriceDown = val.high;
                    inProgress = true;
                    if(lowCrossArr[0].high < val.high) {
                        isSucess = false;
                    }
                }

                if (engulfeUp && inProgress && upCrossArr[upCrossArr.length -1].high < val.high && !hit) {
                    hit = true;
                    buyOrSellPrice = upCrossArr[upCrossArr.length -1].high;
                    direction = 'up';
                }
                if (engulfeDown && inProgress && lowCrossArr[lowCrossArr.length -1].low >  val.low && !hit) {
                    hit = true;
                    buyOrSellPrice = lowCrossArr[lowCrossArr.length -1].low;
                    direction = 'down'
                }
            } else {
                // if (direction === 'up' && val.low < stoplossPriceUp) {
                //     stopLoss = stoplossPriceUp;
                // } else if (direction === 'down' && val.high > stoplossPriceDown) {
                //     stopLoss = stoplossPriceDown;
                // }
            }
        }
    })
    const target = direction === 'up' ? stopLoss || candles[candles.length - 2].high : stopLoss || candles[candles.length - 2]?.low;
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
        let result = firstCross(candles, lasDayCandles);
        return result;
    }
    return { hit: false, inProgress: false };
}

const getHighAndLow = (candles) => {
    let high = 0;
    let low = candles?.[0]?.low;
    candles?.forEach((val) => {
        if (high < val.high) {
            high = val.high;
        } else if (low > val.low) {
            low = val.low;
        }
    });
    return { lastDayHigh: high, lastDayLow: low };
}
