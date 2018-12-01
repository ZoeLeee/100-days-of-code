import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { app } from '../../../ApplicationServices/Application';
import { KeyBoard } from '../../../Common/KeyEnum';
import { Sleep } from '../../../Common/Utils';
import { commandMachine } from '../../../Editor/CommandMachine';
import { JigUtils } from '../../../Editor/JigUtils';
import './ModalStyle/Modal.less';
import * as xaop from 'xaop';
import { Editor } from '../../../Editor/Editor';
export enum ModalPosition
{
    Center = "center",
    Right = "right",
    Left = "left",
    Mouse = "mouse",
    Top = "top",
    Old = "old" // 老位置
}
/**
 *模态框状态
 * @export
 * @enum {number}
 */
export enum ModalState
{
    Ok = 1,
    Cancel = -1
}
export class ModalManage
{
    m_PromisRes: (res: number) => void;//promis回调;
    private m_ModalContainer: HTMLElement;
    Callback: Function = null;
    private m_IsModal: boolean = false;
    events: Function[] = [];
    private m_ModalOldPosition: { left: string, top: string } = { left: "0", top: "0" };

    constructor(private ed: Editor)
    {
        this.ed = ed;
        this.m_ModalContainer = document.createElement("div");
        this.m_ModalContainer.id = "modal";
        this.m_ModalContainer.tabIndex = -1;

        document.getElementById("Webgl").parentNode.appendChild(this.m_ModalContainer);

        this.RegisterEvent();
    }
    // 注册事件
    private RegisterEvent()
    {
        this.m_ModalContainer.addEventListener('keydown', e => this.OnKeyDown(e));

        this.m_ModalContainer.addEventListener('focus', () =>
        {
            app.m_Editor.m_MaskManage.ShowMask();
            this.m_ModalContainer.style.height = "unset";
            this.m_ModalContainer.style.width = "unset";
        }, true);

        this.m_ModalContainer.addEventListener('blur', () =>
        {
            if (!this.m_IsModal)
            {
                app.m_Editor.m_MaskManage.m_Masking.style.display = "none";
                this.m_ModalContainer.style.height = "7%";
                this.m_ModalContainer.style.width = "20%";
            }
            else
                this.m_ModalContainer.focus();
        }, true);

        xaop.begin(this.ed.m_MaskManage, this.ed.m_MaskManage.OnFocusEvent, (e: KeyboardEvent) =>
        {
            if (this.m_IsModal)
                this.m_ModalContainer.focus();
        });
    }
    OnKeyDown(e: KeyboardEvent)
    {
        switch (e.keyCode)
        {
            case KeyBoard.F1:
                e.preventDefault();
                break;
            case KeyBoard.Escape:
                this.Clear();
                this.EndCmd();
            case KeyBoard.Enter:
                e.preventDefault();
                break;
        }
        e.stopPropagation();
    }
    RenderModeless(Component: any, pos: ModalPosition, props?: any)
    {
        app.m_Editor.m_MaskManage.ShowMask();
        this.m_ModalContainer.focus();
        ReactDOM.render(<Component {...props} />, this.m_ModalContainer);

        //设置初始位置
        if (pos === ModalPosition.Right)
        {
            this.m_ModalContainer.style.left = window.innerWidth - this.m_ModalContainer.clientWidth - 10 + "px";
            this.m_ModalContainer.style.top = "40px";
        }
        else if (pos === ModalPosition.Center)
        {
            this.m_ModalContainer.style.left = `calc( 50% - ${this.m_ModalContainer.clientWidth / 2}px)`;
            this.m_ModalContainer.style.top = `calc( 50%  - ${(this.m_ModalContainer.clientHeight) / 2}px)`;
        }
        else if (pos === ModalPosition.Mouse)
        {
            let mousePos = app.m_Editor.m_MouseCtrl.m_CurMousePointVCS;
            this.m_ModalContainer.style.left = mousePos.x + 50 + "px";
            this.m_ModalContainer.style.top = mousePos.y - this.m_ModalContainer.clientHeight + "px";
        }
        else if (pos === ModalPosition.Top)
        {
            this.m_ModalContainer.style.left = `calc( 50% - ${this.m_ModalContainer.clientWidth / 2}px)`;
            this.m_ModalContainer.style.top = "40px";
        }
        else if (pos === ModalPosition.Old)
        {
            this.m_ModalContainer.style.left = this.m_ModalOldPosition.left;
            this.m_ModalContainer.style.top = this.m_ModalOldPosition.top;
        }
        this.MoveModal();
    }
    RenderModal(Component: any, pos: ModalPosition, props?: any)
    {
        this.m_IsModal = true;
        this.RenderModeless(Component, pos, props);
    }
    async EndExecingCmd()
    {
        if (commandMachine.m_CommandIng)
        {
            app.m_Editor.Canel();
            await Sleep(10);
        }
    }
    async ExecCmd()
    {
        await this.EndExecingCmd();
        if (commandMachine.CommandStart("draw") !== true)
            return;
        await this.Callback();
        commandMachine.CommandEnd("draw");
    }
    Wait()
    {
        return new Promise(res => this.m_PromisRes = res);
    }
    private MoveModal()
    {
        let dragArea = document.querySelector('#modal [data-id=dragArea]') as HTMLElement;
        if (!dragArea) return;

        let modal = this.m_ModalContainer;
        //鼠标在模态框的位置
        let modalX;
        let modalY;

        dragArea.onmousemove = () =>
            this.m_ModalContainer.focus();

        dragArea.onmousedown = (e) =>
        {
            //底部边界
            let maxBottom = window.innerHeight - modal.offsetHeight;
            modalX = e.clientX - modal.offsetLeft;
            modalY = e.clientY - modal.offsetTop;
            modal.style.cursor = "move";
            document.onmousemove = (e) =>
            {
                let moveX = e.clientX - modalX;
                if (moveX < 0)
                    moveX = 0;
                else if (moveX > window.innerWidth - modal.offsetWidth)
                    moveX = window.innerWidth - modal.offsetWidth;

                let moveY = e.clientY - modalY;

                if (moveY < 0)
                    moveY = 0;
                else if (moveY > maxBottom)
                    moveY = maxBottom;

                if (moveY > 0)
                {
                    modal.style.top = moveY + "px";
                    modalY = e.clientY - modal.offsetTop;
                }
                modal.style.left = moveX + "px";
                modalX = e.clientX - modal.offsetLeft;
                this.m_ModalOldPosition = {
                    left: this.m_ModalContainer.style.left,
                    top: this.m_ModalContainer.style.top
                }
            }
        }
        document.onmouseup = (e) =>
        {
            modal.style.cursor = "default";
            document.onmousemove = null;
        }
    }
    ToggleShow()
    {
        let isShow = window.getComputedStyle(this.m_ModalContainer)['display'] === "block";
        this.m_ModalContainer.style.display = isShow ? "none" : "block";
    }
    Clear()
    {
        ReactDOM.unmountComponentAtNode(this.m_ModalContainer);
        this.m_IsModal = false;
        this.m_ModalContainer.blur();
        this.m_ModalContainer.style.width = "unset";
        this.m_ModalContainer.style.height = "unset";
        app.m_Editor.m_MaskManage.Clear();
        this.events.forEach(f => f());
        this.events.length = 0;
        JigUtils.Destroy();
    }
    EndCmd()
    {
        if (this.m_PromisRes)
            this.m_PromisRes(ModalState.Cancel);
        this.Callback = null;
        this.m_PromisRes = null;
    }
}
