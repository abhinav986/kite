
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
            c2.close > c1.high &&
            c2.low > c1.low;

        if (upPhase1) {
            let validPullbackUp = false;
            let hightestHigh = c2.high;
            let crossCount = 0;
            let dontCrossLow = c1.low;
            let topPrice = 0;
            for(let k = i + 1; k < candles.length; k++) {
                if(candles[k-1].high >= candles[k].high && candles[k].low >= candles[k-1].low) {
                        upPhase1 = false;
                        break;
                }
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
                    if(candles[k].high >= candles[k-1].high) {
                        upPhase1 = false;
                        break;
                    } else {
                        validPullbackUp = true;
                    }
                }
                if(validPullbackUp) {
                    if(candles[k].high > hightestHigh) {
                        crossCount++;
                        topPrice = candles[k].high;
                        if(crossCount === 5) {
                            hit = true;
                            isSucess = true;
                            buyOrSellPrice = candles[k - 1].high;
                            break;
                        }
                        if(crossCount === 1 && candles[k].close <= hightestHigh) {
                            inProgress = false;
                            break;
                        }
                        //  if(crossCount === 2 && candles[k].close <= hightestHigh) {
                        //     inProgress = false;
                        //     break;
                        // }
                        // engulfe avoid
                        if(candles[k-1].low >= candles[k].low && candles[k-1].high <= candles[k].high) {
                            inProgress = false;
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
            c2.close < c1.low &&
            c2.high < c1.high;

        if (downPhase1) {
            let validPullbackDown = false;
            let lowestLow = c2.low;
            let crossCount = 0;
            let dontCrossHigh = c1.high;
            let lowestPrice = 0;
            for (let k = i + 1; k < candles.length; k++) {
                if(candles[k-1].high >= candles[k].high && candles[k].low >= candles[k-1].low) {
                    downPhase1 = false;
                    break;
                }
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
                    if(candles[k-1].low >= candles[k].low) {
                        downPhase1 = false;
                        break;
                    }
                    validPullbackDown = true;
                }

                // After pullback → continuation (breaking lows)
                if (validPullbackDown) {
                    if (candles[k].low < lowestLow) {
                        crossCount++;
                        lowestPrice = candles[k].low;
                        if (crossCount === 5) {
                            hit = true;
                            isSucess = true;
                            buyOrSellPrice = candles[k - 1].low;
                            break;
                        }
                        if(crossCount === 1 && candles[k].close >= lowestLow) {
                            inProgress = false;
                            break;
                        }
                        // if(crossCount === 2 && candles[k].close >= lowestLow) {
                        //     inProgress = false;
                        //     break;
                        // }
                        // engulfe avoid
                        if(candles[k-1].low >= candles[k].low && candles[k-1].high <= candles[k].high) {
                            inProgress = false;
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

export const insidePullbackBreakout = (candles) => {
    let hit = false;
    let inProgress = false;
    let isSucess = false;
    let direction;
    let buyOrSellPrice;
    let stopLoss;

    for (let i = 1; i < candles.length - 6 ; i++) {

        const big1 = candles[i - 1];
        const big2 = candles[i];

        // ==================================
        // BULLISH SETUP
        // ==================================

        let bullishImpulse =
             big1.close > big1.open &&
            big2.close > big2.open &&
            big2.close > big1.high;

        if (bullishImpulse) {
             let crossCount = 0;
             let lowestLow = candles[i + 1].low;
             let engulfeLow = 0;
             let engulfeFirstCandle;
             let engulfeSecondCandle;
            for (let j = i + 1; j <= candles.length - 1; j++) {
                const curr = candles[j];
                const prev = candles[j - 1];

                // if(curr.low <= prev.low && curr.high >= prev.high) {
                //     if(engulfeLow === 0 || curr.low > engulfeLow) {
                //         engulfeLow = curr.low;
                //     }
                // }
                // if(curr.low <= prev.low) {
                //     engulfeFirstCandle = prev;
                //     engulfeSecondCandle = curr;
                // }
                // if(engulfeFirstCandle && curr.high > engulfeFirstCandle.high) {
                //     if(engulfeLow === 0 || engulfeSecondCandle.low > engulfeLow) {
                //         engulfeLow = engulfeSecondCandle.low;
                //     }
                // }
                // if(engulfeLow && curr.low < engulfeLow) {
                //     bullishImpulse = false;
                //     inProgress = false;
                //     buyOrSellPrice = null;
                //     direction = "";
                //     break;
                // }
                // stay inside big candles
                if (
                    (curr.high >= big2.high) && !inProgress
                ) {
                    bullishImpulse = false;
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    break;
                }
                if (
                    (
                    curr.low <= big1.low) && !hit
                ) {
                    bullishImpulse = false;
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    break;
                }
                if(crossCount !== 6 && curr.low < lowestLow) {
                    lowestLow = curr.low;
                    crossCount = crossCount + 1;
                }
                if(crossCount === 6) {
                    direction = "up";
                    inProgress = true;
                }
                if(inProgress && curr.high > big2.high && crossCount === 6) {
                    hit = true;
                    buyOrSellPrice = big2.high;
                    isSucess = true;
                    break;
                }
                

            }
        }

        // ==================================
        // BEARISH SETUP
        // ==================================

        let bearishImpulse =
            big1.close < big1.open &&
            big2.close < big2.open &&
            big2.close < big1.low;

        if (bearishImpulse) {
             let engulfeHigh = 0;
             let engulfeFirstCandle;
             let engulfeSecondCandle;
           let crossCount = 0;
             let highestHigh = candles[i + 1].high;
            for (let j = i + 1; j <= candles.length - 1; j++) {
                const curr = candles[j];
                const prev = candles[j - 1];

            //    if (curr.high >= prev.high && curr.low <= prev.low) {
            //         if (engulfeHigh === 0 || curr.high < engulfeHigh) {
            //             engulfeHigh = curr.high;
            //         }
            //     }

                // if (curr.high >= prev.high) {
                //     engulfeFirstCandle = prev;
                //     engulfeSecondCandle = curr;
                // }

                // if (engulfeFirstCandle && curr.low <= engulfeFirstCandle.low) {
                //     if (engulfeHigh === 0 || engulfeSecondCandle.high < engulfeHigh) {
                //         engulfeHigh = engulfeSecondCandle.high;
                //     }
                // }

                // if (engulfeHigh && curr.high > engulfeHigh) {
                //     bearishImpulse = false;
                //     inProgress = false;
                //     buyOrSellPrice = null;
                //     direction = "";
                //     break;
                // }
                if (
                    (
                    curr.low <= big2.low) && !inProgress
                ) {
                    console.log("inside");
                    bearishImpulse = false;
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    break;
                }
                if (
                    (curr.high >= big1.high) && !hit
                ) {
                    bearishImpulse = false;
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    break;
                }
                if(crossCount !== 6 && curr.high > highestHigh) {
                    highestHigh = curr.high;
                    crossCount = crossCount + 1;
                }
                if(crossCount === 6) {
                    buyOrSellPrice = big2.low;
                    direction = "down";
                    inProgress = true;
                }
                if(inProgress && curr.low < big2.low && crossCount === 6) {
                    hit = true;
                    isSucess = true;
                    break;
                }
                
            }
        }

        if (hit) break;
    }

    const lastCandle = candles[candles.length - 1];

    const target =
        direction === "up"
            ? lastCandle.high
            : lastCandle.low;

    return {
        buyOrSellPrice,
        stopLoss,
        target,
        direction,
        hit,
        inProgress,
        isSucess,
        profitOrLoss:
            direction === "up"
                ? Math.floor((target || 0) - (buyOrSellPrice || 0))
                : Math.floor((buyOrSellPrice || 0) - (target || 0)),
        time: candles[0]?.date,
    };
};

export const closingTwoEngulfe = (candles) => {
    let hit = false;
    let inProgress = false;
    let isSucess = false;
    let direction;
    let buyOrSellPrice;
    let stopLoss;
    let engulfeLow = 0;
    let engulfeLowHigh = 0;
    let engulfeFirstCandle;
    let engulfeSecondCandle;
    let engulfeFirstCandleLow;
    let engulfeSecondCandleLow;
    let engulfeHigh = 0;
    let engulfeHighLow = 0;
    let time;

    for (let i = 1; i < candles.length - 6 ; i++) {

        const big1 = candles[i - 1];
        const big2 = candles[i];
        const curr = candles[i];
        const prev = candles[i - 1];
        if(curr.low < prev.low && curr.close > prev.high) {
            if(engulfeLow === 0 || curr.low > engulfeLow) {
                engulfeLow = curr.low;
                engulfeLowHigh = curr.high;
            }
        }
        if(curr.low < prev.low) {
            engulfeFirstCandle = prev;
            engulfeSecondCandle = curr;
        }
        if(engulfeFirstCandle && curr.close > engulfeFirstCandle.high) {
            if(engulfeLow === 0 || engulfeSecondCandle.low > engulfeLow) {
                engulfeLow = engulfeSecondCandle.low;
                engulfeLowHigh = curr.high;
            }
        }
       

        if (engulfeLow) {
            let downSide = false;
            let upside = false;
            let secondEngulfe = false;
            let upperLimit;
            let firstCross = false;
            let secondEngulfeLow = 0;
            for (let j = i + 1; j <= candles.length - 1; j++) {
               if(!downSide && !upperLimit && candles[j].low < candles[j-1].low) {
                    downSide = true;
                    upperLimit = candles[j-1].high;
                    time = candles[j-1].date;
                    if(candles[j-1].high <= engulfeLowHigh) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeLow = 0;
                        engulfeFirstCandle = null;
                        engulfeSecondCandle = null;
                        break;
                    }
                }
                 if(candles[j].close < engulfeLow && !secondEngulfeLow) {
                    secondEngulfe = true;
                    secondEngulfeLow = candles[j].low
                    inProgress = true;
                }
                if(secondEngulfe && candles[j].high > candles[j-1].high && !upside) {
                    inProgress = true;
                    upside = true;
                    if(secondEngulfeLow <= candles[j-1].low) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeLow = 0;
                        engulfeFirstCandle = null;
                        engulfeSecondCandle = null;
                        break;
                    }
                }
                if(downSide && !upside && candles[j].high >= candles[j-1].high) {
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeLow = 0;
                    engulfeFirstCandle = null;
                    engulfeSecondCandle = null;
                    break;
                }
               
                if(upside && secondEngulfe && candles[j].low <= candles[j-1].low) {   
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeLow = 0;
                    engulfeFirstCandle = null;
                    engulfeSecondCandle = null;
                    break;
                }
                if(upside && !firstCross && candles[j].high > upperLimit) {
                    inProgress = true;
                    direction = "up";
                    if(candles[j].close > upperLimit) {
                        firstCross = true;
                    }
                    upperLimit =  candles[j].high;
                }
                if(upside && firstCross && candles[j].high > upperLimit) {
                    inProgress = true;
                    buyOrSellPrice = upperLimit;
                    direction = "up";
                    hit = true;
                    break;
                }
            }
        }

        if (curr.high > prev.high && curr.close < prev.low) {
            if (engulfeHigh === 0 || curr.high < engulfeHigh) {
                engulfeHigh = curr.high;
                engulfeHighLow = curr.low;
            }
        }

        if (curr.high > prev.high) {
            engulfeFirstCandleLow = prev;
            engulfeSecondCandleLow = curr;
        }

        if (engulfeFirstCandleLow && curr.close < engulfeFirstCandleLow.low) {
            if (engulfeHigh === 0 || engulfeSecondCandleLow.high < engulfeHigh) {
                engulfeHigh = engulfeSecondCandleLow.high;
                engulfeHighLow = curr.low;
            }
        }

       if (engulfeHigh) {
            let upside = false;
            let downside = false;
            let secondEngulfe = false;
            let lowerLimit;
            let firstCross = false;
            let secondEngulfeHigh = 0;
            for (let j = i + 1; j <= candles.length - 1; j++) {

                if(!upside && !lowerLimit && candles[j].high > candles[j-1].high) {
                    upside = true;
                    lowerLimit = candles[j-1].low;
                    time = candles[j-1].date;
                    if(candles[j-1].low >= engulfeHighLow) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeHigh = 0;
                        engulfeFirstCandleLow = null;
                        engulfeSecondCandleLow = null;
                        break;
                    }
                }
                 if(candles[j].close > engulfeHigh && !secondEngulfeHigh) {
                    secondEngulfe = true;
                    secondEngulfeHigh = candles[j].high;
                }
                if(secondEngulfe && candles[j].low < candles[j-1].low && !downside) {
                    inProgress = true;
                    downside = true;
                    if(secondEngulfeHigh >= candles[j-1].high) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeHigh = 0;
                        engulfeFirstCandleLow = null;
                        engulfeSecondCandleLow = null;
                        break;
                    }
                }
                if(upside && !downside && candles[j].low <= candles[j-1].low) {
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeHigh = 0;
                    engulfeFirstCandleLow = null;
                    engulfeSecondCandleLow = null;
                    break;
                }
               
                if(downside && secondEngulfe && candles[j].high >= candles[j-1].high) {   
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeHigh = 0;
                    engulfeFirstCandleLow = null;
                    engulfeSecondCandleLow = null;
                    break;
                }
                if(downside && !firstCross && candles[j].low < lowerLimit) {
                    inProgress = true;
                    direction = "down";
                    if(candles[j].close > lowerLimit) {
                        firstCross = true;
                    }
                    lowerLimit =  candles[j].low;
                }
                if(downside && firstCross && candles[j].low < lowerLimit) {
                    inProgress = true;
                    buyOrSellPrice = lowerLimit;
                    direction = "down";
                    hit = true;
                    break;
                }
            }
        }

        if (hit) break;
    }

    const lastCandle = candles[candles.length - 1];

    const target =
        direction === "up"
            ? lastCandle.high
            : lastCandle.low;

    return {
        buyOrSellPrice,
        stopLoss,
        target,
        direction,
        hit,
        inProgress,
        isSucess,
        profitOrLoss:
            direction === "up"
                ? Math.floor((target || 0) - (buyOrSellPrice || 0))
                : Math.floor((buyOrSellPrice || 0) - (target || 0)),
        time,
    };
};

export const newBestTracker = (candles) => {
    let hit = false;
    let inProgress = false;
    let isSucess = false;
    let direction;
    let buyOrSellPrice;
    let stopLoss;
    let engulfeLow = 0;
    let engulfeLowHigh = 0;
    let engulfeFirstCandle;
    let engulfeSecondCandle;
    let engulfeFirstCandleLow;
    let engulfeSecondCandleLow;
    let engulfeHigh = 0;
    let engulfeHighLow = 0;
    let upperLimit = 0;
    let secondEngulfePrice = 0;
    let time;
    let lowerLimit = 99999999999;

    for (let i = 1; i < candles.length - 6 ; i++) {

        const big1 = candles[i - 1];
        const big2 = candles[i];
        const curr = candles[i];
        const prev = candles[i - 1];
       
        const isBullishEngulfing = big1.close > big1.open &&
            big2.close > big2.open &&
            big2.close > big1.high;
        // if(curr.low < prev.low && !(curr.high >= prev.high)) {
        //     engulfeFirstCandle = prev;
        //     engulfeSecondCandle = curr;
        // }
        // if(engulfeFirstCandle && curr.close > engulfeFirstCandle.high) {
        //     if(engulfeLow === 0 || engulfeSecondCandle.low > engulfeLow) {
        //         engulfeLow = engulfeSecondCandle.low;
        //         engulfeLowHigh = curr.high;
        //     }
        // }
        if (isBullishEngulfing) {
            engulfeFirstCandle = big1;
            engulfeSecondCandle = big2;
            if(engulfeLow === 0 || engulfeSecondCandle.low > engulfeLow) {
                engulfeLow = engulfeSecondCandle.low;
                engulfeLowHigh = engulfeSecondCandle.high;
            }
        }
        if (engulfeLow) {
            let downSide = false;
            let upside = false;
            let secondEngulfe = false;
            upperLimit = (curr.high > prev.high) && (curr.high > upperLimit) ? curr.high : upperLimit;
            let firstCross = false;
            let secondEngulfeLow = 0;
            secondEngulfePrice = (curr.high > prev.high) && curr.high >=upperLimit ?  prev.low : secondEngulfePrice;
            for (let j = i + 1; j <= candles.length - 1; j++) {
               if(!downSide && candles[j].low < candles[j-1].low) {
                    downSide = true;
                    time = candles[j-1].date;
                    if(candles[j-1].high <= engulfeLowHigh) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeLow = 0;
                        engulfeFirstCandle = null;
                        engulfeSecondCandle = null;
                        upperLimit = 0;
                        secondEngulfePrice = 0;
                        break;
                    }
                }
                if(!downSide && candles[j].high > upperLimit) {
                    upperLimit = candles[j].high;
                    secondEngulfePrice = candles[j-1].low;
                }
                 if(candles[j].low < engulfeLow) {
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeLow = 0;
                    engulfeFirstCandle = null;
                    engulfeSecondCandle = null;
                    upperLimit = 0;
                    secondEngulfePrice = 0;
                    break;
                }
                if (candles[j].close < secondEngulfePrice && !secondEngulfe) {
                    secondEngulfe = true;
                    secondEngulfeLow = candles[j].low;
                }
                if(downSide && !secondEngulfe && candles[j].high > upperLimit) {
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeLow = 0;
                    engulfeFirstCandle = null;
                    engulfeSecondCandle = null;
                    upperLimit = 0;
                    secondEngulfePrice = 0;
                    break;
                }
                if(secondEngulfe && candles[j].high > candles[j-1].high && !upside) {
                    inProgress = true;
                    upside = true;
                    if(secondEngulfeLow <= candles[j-1].low) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeLow = 0;
                        engulfeFirstCandle = null;
                        engulfeSecondCandle = null;
                        upperLimit = 0;
                        secondEngulfePrice = 0;
                        break;
                    }
                }
                if(downSide && !upside && candles[j].high > candles[j-1].high) {
                     inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeLow = 0;
                        engulfeFirstCandle = null;
                        engulfeSecondCandle = null;
                        upperLimit = 0;
                        secondEngulfePrice = 0;
                        break;
                }
               
                if(upside && secondEngulfe && candles[j].low < candles[j-1].low) {   
                     inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeLow = 0;
                        engulfeFirstCandle = null;
                        engulfeSecondCandle = null;
                        upperLimit = 0;
                        secondEngulfePrice = 0;
                        break;
                }
                if(upside && !firstCross && candles[j].high > upperLimit) {
                    inProgress = true;
                    direction = "up";
                    if(candles[j].close > upperLimit) {
                        firstCross = true;
                        inProgress = true;
                        buyOrSellPrice = upperLimit;
                        direction = "up";
                        hit = true;
                        break;
                    } else {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeLow = 0;
                        engulfeFirstCandle = null;
                        engulfeSecondCandle = null;
                        upperLimit = 0;
                        secondEngulfePrice = 0;
                        break;
                    }
                }
                // if(upside && firstCross && candles[j].high > upperLimit) {
                //     inProgress = true;
                //     buyOrSellPrice = upperLimit;
                //     direction = "up";
                //     hit = true;
                //     break;
                // }
            }
        }

        let bearishImpulse =
            big1.close < big1.open &&
            big2.close < big2.open &&
            big2.close < big1.low;

        if(bearishImpulse) {
            engulfeFirstCandleLow = big1;
            engulfeSecondCandleLow = big2;
            if (engulfeHigh === 0 || engulfeSecondCandleLow.high < engulfeHigh) {
                engulfeHigh = engulfeSecondCandleLow.high;
                engulfeHighLow = curr.low;
         }
        }
        // if (curr.high > prev.high && !(curr.low <= prev.low)) {
        //     engulfeFirstCandleLow = prev;
        //     engulfeSecondCandleLow = curr;
        // }

        // if (engulfeFirstCandleLow && curr.close < engulfeFirstCandleLow.low) {
        //     if (engulfeHigh === 0 || engulfeSecondCandleLow.high < engulfeHigh) {
        //         engulfeHigh = engulfeSecondCandleLow.high;
        //         engulfeHighLow = curr.low;
        //     }
        // }

       if (engulfeHigh) {
            let upside = false;
            let downside = false;
            let secondEngulfe = false;
            lowerLimit = (curr.low < prev.low) && (curr.low < lowerLimit) ? curr.low : lowerLimit;
            let firstCross = false;
            let secondEngulfeHigh = 0;
            secondEngulfePrice = (curr.low < prev.low) && curr.low <= lowerLimit ?  prev.high : secondEngulfePrice;
            for (let j = i + 1; j <= candles.length - 1; j++) {
                if(!upside && candles[j].high > candles[j-1].high) {
                    upside = true;
                    time = candles[j-1].date;
                    if(candles[j-1].low >= engulfeHighLow) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeHigh = 0;
                        engulfeFirstCandleLow = null;
                        engulfeSecondCandleLow = null;
                        lowerLimit = 99999999999;
                        secondEngulfePrice = 0;
                        break;
                    }
                }
                if(!upside && candles[j].low < lowerLimit) {
                    lowerLimit = candles[j].low;
                    secondEngulfePrice = candles[j-1].high;
                }
                 if(candles[j].high > engulfeHigh) {
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeHigh = 0;
                    engulfeFirstCandleLow = null;
                    engulfeSecondCandleLow = null;
                    lowerLimit = 999999999999999;
                    secondEngulfePrice = 0;
                    break;
                }
                if (candles[j].close > secondEngulfePrice && !secondEngulfe) {
                    secondEngulfe = true;
                    secondEngulfeHigh = candles[j].high;
                }
                if(upside && !secondEngulfe && candles[j].low < lowerLimit) {
                    inProgress = false;
                    buyOrSellPrice = null;
                    direction = "";
                    engulfeHigh = 0;
                    engulfeFirstCandleLow = null;
                    engulfeFirstCandleLow = null;
                    lowerLimit = 99999999999;
                    secondEngulfePrice = 0;
                    break;
                }
                if(secondEngulfe && candles[j].low < candles[j-1].low && !downside) {
                    inProgress = true;
                    downside = true;
                    if(secondEngulfeHigh >= candles[j-1].high) {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeHigh = 0;
                        engulfeFirstCandleLow = null;
                        engulfeSecondCandleLow = null;
                        lowerLimit = 999999999999999;
                        secondEngulfePrice = 0;
                        break;
                    }
                }
                if(upside && !downside && candles[j].low < candles[j-1].low) {
                   inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeHigh = 0;
                        engulfeFirstCandleLow = null;
                        engulfeSecondCandleLow = null;
                        lowerLimit = 999999999999999;
                        secondEngulfePrice = 0;
                        break;
                }
               
                if(downside && secondEngulfe && candles[j].high > candles[j-1].high) {   
                         inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeHigh = 0;
                        engulfeFirstCandleLow = null;
                        engulfeSecondCandleLow = null;
                        lowerLimit = 999999999999999;
                        secondEngulfePrice = 0;
                        break;
                }
                if(downside && !firstCross && candles[j].low < lowerLimit) {
                    inProgress = true;
                    direction = "down";
                    if(candles[j].close < lowerLimit) {
                        firstCross = true;
                        inProgress = true;
                        buyOrSellPrice = lowerLimit;
                        direction = "down";
                        hit = true;
                        break;
                    } else {
                        inProgress = false;
                        buyOrSellPrice = null;
                        direction = "";
                        engulfeHigh = 0;
                        engulfeFirstCandleLow = null;
                        engulfeSecondCandleLow = null;
                        lowerLimit = 9999999999999;
                        secondEngulfePrice = 0;
                        break;
                    }
                }
                // if(downside && firstCross && candles[j].low < lowerLimit) {
                //     inProgress = true;
                //     buyOrSellPrice = lowerLimit;
                //     direction = "down";
                //     hit = true;
                //     break;
                // }
            }
        }

        if (hit) break;
    }

    const lastCandle = candles[candles.length - 1];

    const target =
        direction === "up"
            ? lastCandle.high
            : lastCandle.low;

    return {
        buyOrSellPrice,
        stopLoss,
        target,
        direction,
        hit,
        inProgress,
        isSucess,
        profitOrLoss:
            direction === "up"
                ? Math.floor((target || 0) - (buyOrSellPrice || 0))
                : Math.floor((buyOrSellPrice || 0) - (target || 0)),
        time,
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
