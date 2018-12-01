import { Box3, Vector3 } from "three";
import { arrayLast, arrayRemoveDuplicateBySort, arrayRemoveIf, arraySortByNumber } from "../Common/ArrayExt";
import { curveLinkGroup, GetPointAtCurveDir } from "../Common/CurveUtils";
import { Status } from "../Common/Status";
import { FixIndex } from "../Common/Utils";
import { Arc } from "../DatabaseServices/Arc";
import { Circle } from "../DatabaseServices/Circle";
import { Contour } from '../DatabaseServices/Contour';
import { Curve } from "../DatabaseServices/Curve";
import { Line } from "../DatabaseServices/Line";
import { Polyline } from '../DatabaseServices/Polyline';
import { equaln, equalv2, equalv3 } from "../Geometry/GeUtils";
import { EBox, SortEntityByBox } from "../Geometry/SortEntityByBox";
import { IsPtsAllOutOrOnReg } from "./BoolOperateUtils";
import { IntersectOption } from "./IntersectWith";

interface offsetRes
{
    index: number;
    curve: Curve;
}

export class PolyOffsetUtil
{
    private m_Polyline: Polyline;
    private m_OffsetDist: number;
    private m_Contours: Contour[] = [];//构建的轮廓
    private m_RetCurves: Curve[] = [];//第一步修剪的数组
    //偏移距离平方值
    private m_dist2: number;
    //偏移距离绝对值
    private m_AbsDist: number;
    //不用裁剪的线段
    private unNeedCutCus: Curve[] = [];
    //源线段点数量
    private m_PtCount: number;
    constructor(pl: Polyline, offset: number)
    {
        this.m_Polyline = pl.Clone();
        this.m_OffsetDist = offset;
        this.m_dist2 = Math.pow(offset, 2);
        this.m_AbsDist = Math.abs(this.m_OffsetDist);
        this.m_PtCount = pl.EndParam;
    }
    GetOffsetCurves(isCalcPath = false): Curve[]
    {
        const originOCS = this.m_Polyline.OCS;
        this.m_Polyline.ApplyMatrix(this.m_Polyline.OCSInv);

        let expCus = this.m_Polyline.Explode();
        let offres = this.OffestCurve(expCus);
        //不闭合曲线传入首尾点构建圆轮廓
        if (!this.m_Polyline.IsClose)
        {
            let cir1 = new Circle(this.m_Polyline.StartPoint, this.m_AbsDist);
            let cir2 = new Circle(this.m_Polyline.EndPoint, this.m_AbsDist);
            this.m_Contours.push(Contour.CreateContour([cir1]));
            this.m_Contours.push(Contour.CreateContour([cir2]));
        }
        //连接修剪并构建轮廓
        this.TrimAndBuildContour(offres);
        //裁剪并优化的曲线
        let boxCurves = this.trimByContours();
        //优化删除无效和连接共线,必须执行上一步
        this.optimizeCus(boxCurves);
        this.linkCurves();

        //如果源线段闭合只保留闭合的部分(理论上可以删除这个判断)
        if (!isCalcPath && this.m_Polyline.IsClose)
            this.m_RetCurves = this.m_RetCurves.filter(c => c.IsClose);

        if (!isCalcPath && this.m_Polyline.CloseMark)
            this.m_RetCurves.forEach(pl => (<Polyline>pl).CloseMark = true);

        return this.m_RetCurves.map(pl => pl.ApplyMatrix(originOCS));
    }
    private CheckPointDir(pt: Vector3)
    {
        let dir = GetPointAtCurveDir(this.m_Polyline, pt) ? 1 : -1;
        return dir === Math.sign(this.m_OffsetDist);
    }

    /**
     * 优化裁剪后的曲线(删除没意义的线),合并共线
     * @private
     * @param {Map<EBox, Box3>} boxCurves 曲线对应的包围盒列表
     * @returns
     * @memberof PolyOffestUtil
     */
    private optimizeCus(boxCurves: Map<EBox, Box3>)
    {
        //过滤掉无效的线段
        this.m_RetCurves = this.m_RetCurves.filter(c =>
        {
            //与源线段自交
            if (equaln(c.Length, 0, 1e-6) || c.IntersectWith(this.m_Polyline, IntersectOption.OnBothOperands).length !== 0)
                return false;
            //删除在反方向的无效线段
            return this.CheckPointDir(c.StartPoint) || this.CheckPointDir(c.EndPoint);
        });

        //处理自交的线段,先根据包围盒排序
        this.m_RetCurves.sort((e1, e2) =>
        {
            let b1 = boxCurves.get(e1);
            let b2 = boxCurves.get(e2);
            if (!equaln(b1.min.x, b2.min.x))
                return b1.min.x - b2.min.x;
            else
                return b2.min.y - b1.min.y;
        })

        // 寻找自交线段
        for (let i = 0; i < this.m_RetCurves.length; i++)
        {
            let c1 = this.m_RetCurves[i];
            let c1b = boxCurves.get(c1);

            for (let j = i + 1; j < this.m_RetCurves.length; j++)
            {
                let c2 = this.m_RetCurves[j];
                let c2b = boxCurves.get(c2);

                //过滤掉不需要计算的曲线
                if (c2b.min.x - 1e-6 > c1b.max.x)
                    break;
                if (c2b.min.y - 1e-6 > c1b.max.y)
                    continue;

                //有共线部分才允许合并.
                if (c2.PtOnCurve2(c1.StartPoint) || c2.PtOnCurve2(c1.EndPoint)
                    || c1.PtOnCurve2(c2.StartPoint) || c1.PtOnCurve2(c2.EndPoint)
                    || (c1.PtOnCurve(c2.StartPoint) && c1.PtOnCurve(c2.EndPoint))
                )
                    if (c1.Join(c2) === Status.True)
                    {
                        this.m_RetCurves.splice(j, 1);
                        c1b = c1.BoundingBox;
                        boxCurves.set(c1, c1b);
                        j--;
                    }
            }
        }
    }
    //偏移曲线
    private OffestCurve(pls: Curve[]): offsetRes[]
    {
        return pls.map((cu, index) =>
        {
            let curve = cu.GetOffsetCurves(this.m_OffsetDist)[0];
            return { curve, index };
        });
    }

    /**
     * 根据2曲线或者一曲线一点构造轮廓
     * @private
     * @param {Curve} cu
     * @param {Curve} [cuOrPt]
     * @returns
     * @memberof PolyOffestUtil
     */
    private BuildContour(cu: Curve, cuOrPt: Curve | Vector3): Contour
    {
        if (cuOrPt instanceof Curve)
        {
            let l1 = new Line(cu.StartPoint, cuOrPt.StartPoint);
            let l2 = new Line(cu.EndPoint, cuOrPt.EndPoint);

            //若2曲线都是圆弧，构建轮廓可能裁剪掉圆弧，把被裁剪掉的圆弧存入数组跳过后续运算
            if (cu instanceof Arc && cuOrPt instanceof Arc)
            {
                //被起点连线裁剪放入前面那段，被终点连线裁剪放入后面那段
                [l1, l2].forEach((l, i) =>
                {
                    let pts = l.IntersectWith(cuOrPt, 0);
                    if (pts.length === 2)
                    {
                        let splitCus = cuOrPt.GetSplitCurvesByPts(pts);
                        this.unNeedCutCus.push(splitCus[i])
                    }
                })
            }
            //防止轮廓自交
            if (l1.IntersectWith(l2, 0).length > 0)
            {
                l1 = new Line(cu.StartPoint, cuOrPt.EndPoint);
                l2 = new Line(cu.EndPoint, cuOrPt.StartPoint);
            }
            return Contour.CreateContour([
                cu.Clone() as Curve,
                cuOrPt.Clone() as Curve,
                l1,
                l2
            ]);
        }
        else
        {
            let l1 = new Line(cu.StartPoint, cuOrPt);
            let l2 = new Line(cu.EndPoint, cuOrPt);
            return Contour.CreateContour([
                cu,
                l1,
                l2
            ]);
        }
    }

    /**
     *通过源线段索引或者点构建圆轮廓
     * @private
     * @param {(number | Vector3)} iV 源线段索引或者圆心
     * @param {Contour[]} cons
     * @memberof PolyOffestUtil
     */
    private BuildCircleContour(iV: number | Vector3, cons: Contour[])
    {
        let center: Vector3;
        if (iV instanceof Vector3)
            center = iV;
        else
            center = this.m_Polyline.GetPointAtParam(iV);

        let cir = new Circle(center, this.m_AbsDist)
        cons.push(Contour.CreateContour([cir]));
    }
    /**
     * 连接修剪相邻曲线,并构造修剪轮廓
     *
     * @private
     * @param {offsetRes[]} offResList
     * @memberof PolyOffestUtil
     */
    private TrimAndBuildContour(offResList: offsetRes[])
    {
        arrayRemoveIf(offResList, r => !r.curve || equaln(r.curve.Length, 0, 1e-6));

        if (offResList.length <= 1)
        {
            this.m_RetCurves = offResList.map(r => r.curve);
            return;
        }
        let cirContours: Contour[] = [];
        //下一线段起始点
        let nextStartPt: Vector3 = offResList[0].curve.StartPoint;
        for (let i = 0; i < offResList.length; i++)
        {
            //源线段对应索引
            let startIndex = offResList[i].index;
            //后面线对应源线段索引
            let endIndex = offResList[FixIndex(i + 1, offResList)].index;

            //前面线
            let frontLine = offResList[i].curve;
            //后面线
            let laterLine: Curve;

            if (i === 0 && !this.m_Polyline.IsClose)
            {
                if (startIndex !== 0)
                {
                    this.BuildCircleContour(1, cirContours);
                }
            }

            //3.如果曲线不不闭合,那么最后一段时候退出,如果最后一段丢失，添加圆轮廓
            if (i === offResList.length - 1 && !this.m_Polyline.IsClose)
            {
                if (startIndex !== this.m_PtCount - 1)
                {
                    this.BuildCircleContour(startIndex + 1, cirContours);
                }
                this.appendNewCuAndContour(frontLine, nextStartPt, frontLine.EndPoint, startIndex);
                break;
            }
            laterLine = offResList[FixIndex(i + 1, offResList)].curve;


            //#region 1.中间丢失线段的情况下且循环到尾部,补圆弧.
            let isFillArc = !equalv2(
                this.m_Polyline.GetPoint2dAt(FixIndex(startIndex + 1, this.m_PtCount)),
                this.m_Polyline.GetPoint2dAt(endIndex)
            );

            if (isFillArc)
            {
                //在丢失圆的地方构建圆轮廓
                for (let i = startIndex + 1; ; i++)
                {
                    let index = FixIndex(i, this.m_PtCount);
                    this.BuildCircleContour(index, cirContours);
                    if (index === endIndex) break;
                }
                //丢失圆弧时在丢失圆弧的起点构造一个圆
                if (startIndex > endIndex)
                {
                    this.fillArc(startIndex, endIndex, nextStartPt, frontLine, laterLine);
                    continue;
                }
            }
            //#endregion

            //#region 2.修剪延伸,根据真假交点

            let iPts: Vector3[];  //延伸交点
            let tPts: Vector3[];  //都在两条线上的为真交点
            if (equalv3(frontLine.EndPoint, laterLine.StartPoint))
                tPts = [frontLine.EndPoint];
            else
            {
                iPts = frontLine.IntersectWith(laterLine, IntersectOption.ExtendBoth);
                //过滤掉交点为laterline终点的交点
                tPts = iPts.filter(p =>
                    frontLine.PtOnCurve(p)
                    && laterLine.PtOnCurve(p)
                );
            }

            if (tPts.length > 0)//存在真交点情况下直接修剪
            {
                let iPt = PolyOffsetUtil.selectFitInterPt(tPts, frontLine.EndPoint);
                if (isFillArc)
                {
                    //用丢失圆弧和交点构建扇形轮廓
                    for (let i = startIndex + 1; ; i++)
                    {
                        let index = FixIndex(i, this.m_PtCount);
                        let cu = this.m_Polyline.GetCurveAtParam(index);
                        cirContours.push(this.BuildContour(cu, iPt));

                        if (index === endIndex - 1) break;
                    }
                }
                this.appendNewCuAndContour(frontLine, nextStartPt, iPt, startIndex);
            }
            else if (isFillArc || iPts.length === 0)//连交点都没或者圆弧丢失补圆弧
            {
                this.fillArc(startIndex, endIndex, nextStartPt, frontLine, laterLine);
            }
            else //iPts.length > 0 有交点,但是都是假交点.
            {
                let iPt = PolyOffsetUtil.selectFitInterPt(iPts, frontLine.EndPoint);
                //通过真假交点连接
                this.checkCuAndAppendList(frontLine, laterLine, iPt, nextStartPt, startIndex, endIndex);
            }
            //#endregion
        }

        //曲线闭合的时,修改第一条的起点,更新第一个轮廓
        if (this.m_Polyline.IsClose)
        {
            this.m_RetCurves[0].StartPoint = nextStartPt;
            this.m_Contours[0] = this.BuildContour(
                this.m_Polyline.GetCurveAtParam(offResList[0].index),
                this.m_RetCurves[0]);
        };
        this.m_Contours.push(...cirContours);
    }

    /**
     * 将线段拷贝并修改,加入到结果数组里面
     * 构建轮廓加入轮廓数组.
     *
     * @param {Curve} offsetedCurve 偏移后的曲线
     * @param {Vector3} startPoint 修改曲线的起点，修改后将起点设置为终点
     * @param {Vector3} endPoint 修改曲线的中点
     * @param {number} index 偏移前该线段的索引
     * @memberof PolyOffestUtil
     */
    appendNewCuAndContour(offsetedCurve: Curve,
        startPoint: Vector3,
        endPoint: Vector3,
        index: number
    )
    {
        //复制一条新曲线，修改起始点和终止点，并修改下一段的起始点
        let newCu = offsetedCurve.Clone() as Curve;
        newCu.StartPoint = startPoint;
        newCu.EndPoint = endPoint;
        startPoint.copy(endPoint);
        this.m_RetCurves.push(newCu);
        let originCu = this.m_Polyline.GetCurveAtParam(index);
        this.m_Contours.push(this.BuildContour(originCu, newCu));
    }

    /**
     * 检测偏移线段是否有效并加入结果曲线数组
     * 已经排除点都是真交点的情况
     * @private
     * @param {Curve} frontLine 
     * @param {Curve} laterLine 
     * @param {Vector3} intPt 
     * @param {Vector3} nextPt 
     * @param {number} endIndex 
     * @memberof PolyOffestUtil
     */
    private checkCuAndAppendList(frontLine: Curve, laterLine: Curve, intPt: Vector3, nextPt: Vector3, startIndex: number, endIndex: number)
    {
        let par1 = frontLine.GetParamAtPoint(intPt);

        //2段都是圆弧和其他情况分开判断
        if (frontLine instanceof Arc && laterLine instanceof Arc)
        {
            let isOnFline = frontLine.PtOnCurve(intPt);
            let isOnLline = laterLine.PtOnCurve(intPt);
            //交点均不在2圆弧上,直接加入结果数组,否则补圆弧连接
            if (!isOnFline && !isOnLline) //可能 isOnFline || isOnLline
            {
                this.appendNewCuAndContour(frontLine, nextPt, intPt, startIndex);
            }
            else
            {
                this.fillArc(startIndex, endIndex, nextPt, frontLine, laterLine);
            }
        }
        else
        {
            let par2 = laterLine.GetParamAtPoint(intPt);
            if (par1 > 1)
            {
                //laterline是圆弧且都是正假交点,补圆弧,否则连接
                if (par2 > 0 && laterLine instanceof Arc)
                {
                    this.fillArc(startIndex, endIndex, nextPt, frontLine, laterLine);
                }
                else
                {
                    this.appendNewCuAndContour(frontLine, nextPt, intPt, startIndex);
                }
            }
            else if (frontLine instanceof Arc)
            {
                //其余情况如果frontline是Arc,补圆弧,否则补直线
                this.fillArc(startIndex, endIndex, nextPt, frontLine, laterLine);
            }
            else//frontLine is Line
            {
                this.appendNewCuAndContour(frontLine, nextPt, frontLine.EndPoint, startIndex);
                this.m_RetCurves.push(new Line(frontLine.EndPoint, laterLine.StartPoint));
                nextPt.copy(laterLine.StartPoint);
            }
        }
    }
    /**
     * 补圆弧
     * 
     * @param {number} startIndex 源线段索引
     * @param {number} endIndex 源线段索引
     * @param {Vector3} nextPt 修改曲线的起点，修改后将起点设置为终点
     * @param {Curve} frontLine 
     * @param {Curve} laterLine 
     * @returns 
     * @memberof PolyOffestUtil
     */
    fillArc(startIndex: number, endIndex: number,
        nextPt: Vector3,
        frontLine: Curve, laterLine: Curve
    )
    {
        let cirs: Circle[] = [];  //需要补的圆列表
        for (let i = startIndex + 1; ; i++)
        {
            let index = FixIndex(i, this.m_PtCount);
            let center = this.m_Polyline.GetPointAtParam(index);
            if (cirs.length === 0 || !equalv3(arrayLast(cirs).Center, center, 1e-8))
                cirs.push(new Circle(center, this.m_AbsDist));

            if (index === endIndex) break;
        }

        //找到和frontline存在离源线段距离大于偏移距离的交点的圆,跳过这个圆前面的圆计算
        let iPts: Vector3[];
        let index = 1;
        for (; index < cirs.length; index++)
        {
            let pts = frontLine.IntersectWith(cirs[index], 0).filter(p =>
            {
                let dist = p.distanceToSquared(this.m_Polyline.GetClosestPointTo(p, false));
                return dist + 1e-3 > this.m_dist2;
            });
            if (pts.length === 0)
            {
                break;
            }
            else
                iPts = pts;
        }
        if (iPts)
            cirs.splice(0, index - 1);
        else
            iPts = [frontLine.EndPoint];

        let iPt = PolyOffsetUtil.selectFitInterPt(iPts, frontLine.EndPoint);
        this.appendNewCuAndContour(frontLine, nextPt, iPt, startIndex);

        //连接剩下的圆.
        //可能的情况   (|)()(|)() 竖线为直线
        for (let index = 0; index < cirs.length; index++)
        {
            let c1 = cirs[index];//已经计算过的圆

            let iPtsLater: Vector3[];
            if (index === cirs.length - 1)
                iPtsLater = [laterLine.StartPoint];
            else
            {
                //和前面圆的交点需要大于偏移距离才能提前相交
                iPtsLater = c1.IntersectWith(laterLine, 0).filter(p =>
                {
                    let dist = p.distanceToSquared(this.m_Polyline.GetClosestPointTo(p, false));
                    return dist + 1e-3 > this.m_dist2;
                });
            }

            if (iPtsLater.length > 0)//直接和最后一条连接
            {
                let iPt = PolyOffsetUtil.selectFitInterPt(iPtsLater, nextPt);
                this.buildArcJoinList(c1, nextPt, iPt, FixIndex(startIndex + 1, this.m_PtCount) === endIndex);
                return;
            }

            let c2 = cirs[index + 1];

            let iPts = c1.IntersectWith(c2, 0);
            let iPt = PolyOffsetUtil.selectFitInterPt(iPts, nextPt);

            this.buildArcJoinList(c1, nextPt, iPt, FixIndex(startIndex + 1, this.m_PtCount) === endIndex);
        }
    }

    /**
     * 构建补圆弧
     * @param {Circle} cir 补圆
     * @param {Vector3} startPt 补圆的切割点1
     * @param {Vector3} endPt 补圆的切割点2
     * @param {boolean} isbuildCir 是否构建圆轮廓
     * @returns
     * @memberof PolyOffestUtil
     */
    buildArcJoinList(cir: Circle, startPt: Vector3, endPt: Vector3, isbuildCir: boolean)
    {
        let splitCus = cir.GetSplitCurvesByPts([startPt, endPt]);

        startPt.copy(endPt);

        if (splitCus.length === 2) //2圆相交应该有2段，否则相切
        {
            let arc1 = splitCus[0] as Arc;
            let arc2 = splitCus[1] as Arc;

            let tmpPts = cir.IntersectWith(this.m_Polyline, IntersectOption.OnBothOperands);
            let onCu0Pts = tmpPts.filter(p => arc1.PtOnCurve(p));
            let onCu1Pts = tmpPts.filter(p => arc2.PtOnCurve(p));

            let lastCu = arrayLast(this.m_RetCurves);

            //让圆弧保持和最后一段首尾相连
            if (!equalv3(arc1.StartPoint, lastCu.EndPoint))
                arc1.Reverse();
            if (!equalv3(arc2.StartPoint, lastCu.EndPoint))
                arc2.Reverse();

            //优先选择和源线段不想交的圆弧,如果都相交或者都不相交,选择和最后一段切线接近的圆弧
            let cu: Arc;
            if (onCu0Pts.length === onCu1Pts.length)
            {
                let derv = lastCu.GetFistDeriv(1);
                let derv1 = arc1.GetFistDeriv(0);
                let derv2 = arc2.GetFistDeriv(0);
                cu = derv.angleTo(derv1) < derv.angleTo(derv2) ? arc1 : arc2;
            }
            else
            {
                cu = onCu0Pts.length < onCu1Pts.length ? arc1 : arc2;
            }

            this.m_RetCurves.push(cu);

            isbuildCir && this.BuildCircleContour(cu.Center, this.m_Contours);
        }
    }
    // 通过构建的轮廓对偏移曲线进行裁剪
    private trimByContours()
    {
        let boxContours = SortEntityByBox(this.m_Contours, false);
        let boxCurves = SortEntityByBox(this.m_RetCurves, false);
        this.m_Contours.forEach(c =>
        {
            let tmpCus: Curve[] = [];
            let outline = c.Curve;
            for (let l of this.m_RetCurves)
            {
                if (boxCurves.get(l).min.x > boxContours.get(c).max.x
                    || boxCurves.get(l).max.x < boxContours.get(c).min.x)
                {
                    tmpCus.push(l);
                    continue;
                }

                //交点参数列表
                let iParams = l.IntersectWith(outline, IntersectOption.OnBothOperands)
                    .map(p => l.GetParamAtPoint(p));
                arraySortByNumber(iParams);
                arrayRemoveDuplicateBySort(iParams, equaln);

                //需要计算的点列表
                let needCaclPts: Vector3[] = [];
                if (iParams.length === 0)
                    needCaclPts = [l.StartPoint]
                else
                {
                    for (let i = 0; i < iParams.length - 1; i++)
                    {
                        needCaclPts.push(l.GetPointAtParam((iParams[i] + iParams[i + 1]) / 2));
                    }
                    //如果交点不是首尾点,就加入首尾点
                    if (!equaln(iParams[0], 0, 1e-6))
                        needCaclPts.unshift(l.StartPoint);
                    if (!equaln(arrayLast(iParams), 1, 1e-6))
                        needCaclPts.push(l.EndPoint);
                }

                //切割曲线,缓存切割后曲线包围盒
                if (IsPtsAllOutOrOnReg(outline, needCaclPts))
                {
                    tmpCus.push(l);
                }
                else
                {
                    let cus = l.GetSplitCurves(iParams);

                    //移除0长度线和在轮廓内的线.
                    arrayRemoveIf(cus, cu =>
                        equaln(cu.Length, 0, 1e-6)
                        || outline.PtInCurve(cu.GetPointAtParam(0.5))
                    );
                    cus.forEach(c => boxCurves.set(c, c.BoundingBox))
                    tmpCus.push(...cus);
                }
            }
            this.m_RetCurves = tmpCus;
        })

        //最后也加入优化数组,避免出错
        this.unNeedCutCus.forEach(cu =>
        {
            boxCurves.set(cu, cu.BoundingBox);
            this.m_RetCurves.push(cu);
        })

        return boxCurves;
    }

    /**
     * 连接最终曲线
     * @private
     * @param {Curve[]} cus
     * @memberof PolyOffestUtil
     */
    private linkCurves()
    {
        let groups = curveLinkGroup(this.m_RetCurves);
        let resultPls: Polyline[] = [];
        for (let g of groups)
        {
            let pl = new Polyline();
            for (let cu of g)
                pl.Join(cu);
            resultPls.push(pl)
        }
        this.m_RetCurves = resultPls;
    }

    /**
     * 选择合适的交点
     * @private
     * @param {Vector3[]} pts
     * @param {Vector3} refPt
     * @returns
     * @memberof PolyOffestUtil
     */
    static selectFitInterPt(pts: Vector3[], refPt: Vector3)
    {
        if (pts.length > 1)
        {
            let dist1 = refPt.distanceToSquared(pts[0]);
            let dist2 = refPt.distanceToSquared(pts[1]);
            return dist1 <= dist2 ? pts[0] : pts[1];
        }
        return pts[0];
    }
}
