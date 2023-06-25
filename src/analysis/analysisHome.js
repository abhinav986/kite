import { useState, useEffect } from 'react';
import { get } from '../utils/axios';
import { useParams } from 'react-router-dom';
import AnalyticsSingle from './analysisSingle';
import { gapOpen, engulfe, fourInsideOne, firstCandleCrossBothSide } from '../utils/analysis';
import AnalyticsGap from './analyticsGap';

const AnalyticsHome = () => {
    const { id, name } = useParams();
    const [data, setData] = useState([]);

    useEffect(() => {
        get(`historyData/?id=${id}`).then(res => {
            setData(res.data);
        })
    }, []);

    return (
        <div>
            <h5>{name}</h5>
            <div className='analysis-home'>
                <AnalyticsGap
                    data={[...data]}
                    name={name}
                    analysisFunction={gapOpen}
                    label='Gap Open total' />
                <AnalyticsSingle
                    data={[...data]}
                    name={name}
                    analysisFunction={engulfe}
                    label='Engulfe total' />
                <AnalyticsSingle
                    data={[...data]}
                    name={name}
                    analysisFunction={fourInsideOne}
                    label='Four Inside one total' />
                <AnalyticsSingle
                    data={[...data]}
                    name={name}
                    analysisFunction={firstCandleCrossBothSide}
                    label='First Cross total' />
            </div>
        </div>
    );
};
export default AnalyticsHome;