
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

    let hit = false;
    let buyOrSellPrice;
    let stopLoss = 0;
    let direction;
    let inProgress = false;
    let isSucess = false;

    let breakoutCount = 0;
    let breakdownCount = 0;

    for (let i = 2; i < candles.length - 6; i++) {

        let c0 = candles[i - 2];
        let c1 = candles[i - 1];
        let c2 = candles[i];

        // =========================
        // 🔼 UPTREND LOGIC
        // =========================

        // Phase 1: 2 strong candles
        let upPhase1 =
            c1.close > c0.high &&
            c1.low > c0.low &&
            c2.close > c1.high &&
            c2.low > c1.low;

        if (upPhase1) {
            let validPullbackUp = false;
            let hightestHigh = c2.high;
            let crossCount = 0;
            let dontCrossLow = c1.low;
            let topPrice = 0;
            for(let k = i + 1; k < candles.length; k++) {
                if(crossCount >= 1 && topPrice < candles[k].high) {
                    topPrice = candles[k].high;
                } else if(crossCount >= 1 && topPrice >= candles[k].high) {
                    upPhase1 = false;
                    break;
                }
                if(candles[k].high > candles[k-1].high ) {
                    dontCrossLow = candles[k-1].low;
                }
                if(candles[k].high > hightestHigh && !validPullbackUp) {
                    hightestHigh = candles[k].high;
                }

                if(candles[k].low < candles[k-1].low) {
                    validPullbackUp = true;
                }
                if(validPullbackUp) {
                    if(candles[k].high > hightestHigh) {
                        crossCount++;
                        topPrice = candles[k].high;
                        if(crossCount === 4) {
                            hit = true;
                            isSucess = true;
                            buyOrSellPrice = candles[k - 1].high;
                            break;
                        }
                    }
                }
                if(crossCount === 2) {
                    inProgress = true;
                    direction = 'up';
                }
                
                
                if(candles[k].low < dontCrossLow) {
                    upPhase1 = false;
                    break;
                }
            }
        }

        // =========================
        // 🔽 DOWNTREND LOGIC
        // =========================

        let downPhase1 =
            c1.close < c0.low &&
            c1.high < c0.high &&
            c2.close < c1.low &&
            c2.high < c1.high;

        if (downPhase1) {
            let validPullbackDown = false;
            let lowestLow = c2.low;
            let crossCount = 0;
            let dontCrossHigh = c1.high;
            let lowestPrice = 0;
            for (let k = i + 1; k < candles.length; k++) {
                if(crossCount >= 1 && lowestPrice > candles[k].low) {
                    lowestPrice = candles[k].low;
                } else if(crossCount >= 1 && lowestPrice <= candles[k].low) {
                    downPhase1 = false;
                    break;
                }
                // Track structure shift (lower lows → update protection high)
                if (candles[k].low < candles[k - 1].low) {
                    dontCrossHigh = candles[k - 1].high;
                }

                // Track lowest low before pullback
                if (candles[k].low < lowestLow && !validPullbackDown) {
                    lowestLow = candles[k].low;
                }

                // Pullback detection (opposite of up: higher high)
                if (candles[k].high > candles[k - 1].high) {
                    validPullbackDown = true;
                }

                // After pullback → continuation (breaking lows)
                if (validPullbackDown) {
                    if (candles[k].low < lowestLow) {
                        crossCount++;
                        lowestPrice = candles[k].low;
                        if (crossCount === 4) {
                            hit = true;
                            isSucess = true;
                            buyOrSellPrice = candles[k - 1].low;
                            break;
                        }
                    }
                }

                // Mark mid progress
                if (crossCount === 2) {
                    inProgress = true;
                    direction = 'down';
                }

                // Invalidation condition
                if (candles[k].high > dontCrossHigh) {
                    downPhase1 = false;
                    break;
                }
            }
        }

        // stop early if success
        if (hit) break;
    }

    const lastCandle = candles[candles.length - 1];

    const target =
        direction === 'up'
            ? (lastCandle.high)
            : (lastCandle.low);

    return {
        buyOrSellPrice,
        target,
        profitOrLoss:
            direction === 'up'
                ? Math.floor((target || 0) - (buyOrSellPrice || 0))
                : Math.floor((buyOrSellPrice || 0) - (target || 0)),
        direction,
        time: candles[0]?.date,
        hit,
        inProgress,
        isSucess,
    };
};

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
        isSucess: isSucess,
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
        isSucess: isSucess,
    };
}

export const gapOpen = (candles, lasDayCandles) => {
    const { lastDayHigh, lastDayLow } = getHighAndLow(lasDayCandles);
    if ((lastDayHigh < candles[0]?.high && lastDayHigh < candles[0]?.low) || (lastDayLow > candles[0]?.high && lastDayLow > candles[0]?.low)) {
        // let result = firstCross(candles, lasDayCandles);
        return { hit: false, inProgress: true };
    }
    return { hit: false, inProgress: false };
}

const getHighAndLow = (candles) => {
    let high = candles?.[candles.length-1]?.high;
    let low = candles?.[candles.length-1]?.low;
    console.log(candles);
    // candles?.forEach((val) => {
    //     if (high < val.high) {
    //         high = val.high;
    //     } else if (low > val.low) {
    //         low = val.low;
    //     }
    // });
    return { lastDayHigh: high, lastDayLow: low };
}
