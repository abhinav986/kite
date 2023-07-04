export const engulfeFirst = (candles) => {
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
    let firstCros = false;
    let engulfeUpCandle = {};
    let engulfeDownCandle = {};

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
                    engulfeDown = true;
                    engulfeDownCandle = val;
                    stoplossPriceUp = upCrossArr[upCrossArr.length - 1].high;
                } else if (lowCrossArr.length >= 2 && lowCrossArr[lowCrossArr.length - 2].high < val.high && !hit) {
                    engulfeUp = true;
                    engulfeUpCandle = val;
                    stoplossPriceDown = lowCrossArr[lowCrossArr.length - 2].low;
                }

                if(engulfeUp && isSucess && lowCrossArr[lowCrossArr.length -1].low > val.low) {
                    isSucess = false;
                } else if(engulfeDown && isSucess && upCrossArr[upCrossArr.length -1].high < val.high) {
                    isSucess = false;
                }

                if(!hit && isSucess && engulfeUp && engulfeUpCandle.low > val.low) {
                    firstCros = true;
                } else if(!hit && isSucess && engulfeDown && engulfeDownCandle.high < val.low) {
                    firstCros = true;
                }

                if (engulfeUp && !upFirstCross && isSucess && firstCros) {
                    if (engulfeUpCandle.high < val.high) {
                        upFirstCross = val.high;
                        inProgress = true;
                    }
                }
                if (engulfeDown && !lowFirstCross && isSucess && firstCros) {
                    if (engulfeDownCandle.low > val.low) {
                        lowFirstCross = val.low;
                        inProgress = true;
                    }
                }

                if (upFirstCross && upFirstCross < val.high && index < 21 && !hit && isSucess && firstCros) {
                    hit = true;
                    buyOrSellPrice = upFirstCross;
                    direction = 'up';
                }
                if (lowFirstCross && lowFirstCross > val.low && index < 21  && !hit && isSucess && firstCros) {
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
