export const engulfeTracker = (candles) => {
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
                if (upCrossArr[upCrossArr.length - 1].high < val.high && !engulfeUp) {
                    upCrossArr.push({ high: val.high, low: val.low });
                } else if (lowCrossArr[lowCrossArr.length - 1].low > val.low && !engulfeDown) {
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
            }else {
                if(direction === 'up' && val.low < lowCrossArr[lowCrossArr.length - 1].low) {
                    stopLoss = lowCrossArr[lowCrossArr.length - 1].low;
                } else if(direction === 'down' && val.high > upCrossArr[upCrossArr.length - 1].high) {
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
        time: candles[0]?.date,
        hit: hit,
        inProgress: inProgress,
    };
}