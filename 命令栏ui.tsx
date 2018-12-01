import { observer } from 'mobx-react';
import * as React from 'react';
import { end } from 'xaop';
import { app } from '../../../ApplicationServices/Application';
import { arrayRemoveOnce } from '../../../Common/ArrayExt';
import { KeyWord } from '../../../Common/InputState';
import { KeyBoard } from '../../../Common/KeyEnum';
import { FixIndex, isLetter, isNum } from '../../../Common/Utils';
import { commandMachine } from '../../../Editor/CommandMachine';
import './InputHint.css';
import { Icon } from '@blueprintjs/core';

interface InputHintProps
{
    cmdList: Set<string>,//命令列表

    keyWordList: Array<KeyWord>,//关键字列表

    cmdPrompt: string,//提示字符串
    historyCmdList: string[],

    handleInputCallback: (data: string) => any,//当用户输入一个信息时,应用程序指定回调
}

interface InputHitState
{
    command: string;//输入的命令

    isShowHistory: boolean;//显示历史命令


    intelliSenseIndex: number;//感知的当前选择位置
    intelliSenseCommand: Array<string>;//感知命令列表
    isCNInput: boolean;//是否打开中文输入
}

/**
 *
 *
 * @export
 * @class InputHint
 */

@observer
export class InputHint extends React.Component<InputHintProps, InputHitState>
{
    public state: InputHitState;
    private m_InputEl: HTMLInputElement;
    private m_SelectIndex: number = 0; //选择历史命令索引
    constructor(props)
    {
        super(props);
        this.state =
            {
                command: "",
                isShowHistory: false,
                intelliSenseIndex: -1,
                intelliSenseCommand: [],
                isCNInput: false
            }
    }

    /**
     * 创建组件时
     *
     * @memberof InputHint
     */
    componentDidMount()
    {
        end(app.m_Editor.m_KeyCtrl, app.m_Editor.m_KeyCtrl.OnKeyDown, (e: KeyboardEvent) =>
        {
            //@ts-ignore
            if (document.activeElement !== this.m_InputEl && e.target.nodeName !== "INPUT")
            {
                this.m_InputEl.focus();
            }
            //导致上下键切换命令时bug
            // this.handleOnChangeIntelliSense(this.m_InputEl.value);
            this.handleKeyboardEvent(e);

            if (e.keyCode === KeyBoard.Space || e.keyCode === KeyBoard.Enter)
                return true;
        })
    }

    // 处理input输入的命令,尝试感知
    public handleOnChangeIntelliSense(cmd: string)
    {
        //输入的命令
        let inputCmd = cmd.trim();
        this.setState({ command: inputCmd });
        //没有执行命令才会进行感知
        if (commandMachine.m_CommandIng || this.state.isCNInput)
        {
            return;
        }
        let isIntell = inputCmd.split("").every((str: string) =>
        {
            return isLetter(str) || isNum(str);
        })
        if (inputCmd == "" || !isIntell)
        {
            this.setState({ intelliSenseCommand: [] });
            return;
        }
        inputCmd = inputCmd.toUpperCase();
        // 动态生成正则表达式
        let searchReg: RegExp;
        // 拼接动态正则表达式
        let m_comTmp: string = '^' + inputCmd.split('').join('\\w*') + '\\w*$';
        searchReg = new RegExp(m_comTmp, 'i');

        let intelliSenseCmdList: string[] = [];
        for (let cmdName of this.props.cmdList)
        {
            if (inputCmd.length === 1)
            {
                if (cmdName.indexOf(inputCmd) === 0)
                    intelliSenseCmdList.push(cmdName);
            }
            else if (cmdName.indexOf(inputCmd) !== -1
                || searchReg.test(cmdName))
            {
                intelliSenseCmdList.push(cmdName);
            }
        }
        intelliSenseCmdList.sort((c1, c2) =>
        {
            let lastIndex = 0;
            for (let c of inputCmd)
            {
                let i1 = c1.indexOf(c, lastIndex);
                let i2 = c2.indexOf(c, lastIndex);
                if (i1 != i2)
                    return i1 < i2 ? -1 : 1;
                else
                    lastIndex = i1;
            }
            if (c1.length === c2.length)
                return c1.localeCompare(c2);
            else
                return c1.length < c2.length ? -1 : 1;
        });
        this.setState({
            intelliSenseCommand: intelliSenseCmdList,
            intelliSenseIndex: 0
        });
    }
    // 是否显示历史命令
    public handleShowHistoryCommand = () =>
    {
        this.setState({ isShowHistory: !this.state.isShowHistory });
        document.onclick = () =>
        {
            this.setState({ isShowHistory: false });
            document.onclick = null;
        }
    }

    public handleCallback(cmd: string)
    {
        if (!commandMachine.m_CommandIng)
        {
            let hcmdList = this.props.historyCmdList;
            arrayRemoveOnce(hcmdList, cmd);
            hcmdList.push(cmd);
        }
        this.props.handleInputCallback(cmd);
        this.Cancel();
    }

    //绑定键盘事件
    public handleKeyboardEvent = (e: KeyboardEvent) =>
    {
        switch (e.keyCode)
        {
            case KeyBoard.Escape:
                {
                    this.Cancel();
                    break;
                }
            case KeyBoard.ArrowUp:
            case KeyBoard.ArrowDown:
                {
                    e.preventDefault();
                    this.handleIntellSence(e);
                    break;
                }
            case KeyBoard.Enter:
            case KeyBoard.Space:
                {
                    let cmd = this.m_InputEl.value;
                    if (this.state.intelliSenseCommand.length > 0)
                        cmd = this.state.intelliSenseCommand[this.state.intelliSenseIndex];
                    else if (cmd === "" && !commandMachine.m_CommandIng)
                        cmd = this.props.historyCmdList[this.props.historyCmdList.length - 1]

                    e.stopPropagation();
                    e.preventDefault();
                    this.handleCallback(cmd);
                    break;
                }
        }
    }

    private handleIntellSence(e: KeyboardEvent)
    {
        let intellCout = this.state.intelliSenseCommand.length;
        //如果存在感知
        if (intellCout > 0)
        {
            let index = this.state.intelliSenseIndex;

            if (e.keyCode === KeyBoard.ArrowUp)
            {
                index--;
            }
            else if (e.keyCode == KeyBoard.ArrowDown)
            {
                index++;
            }
            index = FixIndex(index, intellCout);
            this.setState({ intelliSenseIndex: index });
        }
        else
        {
            //历史命令
            if (!commandMachine.m_CommandIng && this.props.historyCmdList.length > 0)
            {
                if (e.keyCode == KeyBoard.ArrowUp)
                {
                    this.m_SelectIndex++;
                }
                else if (e.keyCode == KeyBoard.ArrowDown)
                {
                    this.m_SelectIndex--;
                }
                this.m_SelectIndex = FixIndex(this.m_SelectIndex, this.props.historyCmdList);
                this.setState({ command: this.props.historyCmdList[this.m_SelectIndex] });
            }
        }
    }
    private Cancel()
    {
        this.setState({
            isShowHistory: false,
            intelliSenseCommand: [],
            command: ""
        });
    }

    public render()
    {
        return (
            <div id="input-hint">
                <div className="input" style={{ display: "flex", alignItems: "center" }}>
                    <ul className="recommend-command">
                        {
                            this.state.intelliSenseCommand.map((item: string, index: number) =>
                            {
                                return (
                                    <li
                                        onClick={() => { this.handleCallback(item) }}
                                        key={index}
                                        className={index == this.state.intelliSenseIndex ? "hover" : ""}
                                        onMouseMove={() => { this.setState({ intelliSenseIndex: index }) }}
                                    >
                                        {item}
                                    </li>
                                )
                            })
                        }
                    </ul>
                    <Icon icon="sort-asc" onClick={this.handleShowHistoryCommand} color={"#106ba3"} />
                    <span className="hint">{this.props.cmdPrompt}</span>
                    {
                        this.props.keyWordList.map((item, index: number) =>
                        {
                            return (
                                <span
                                    key={index}
                                    className="hint vice-hint"
                                    onClick={() => { this.handleCallback(item.key) }}
                                >
                                    [{item.msg}<span>({item.key})</span>]
                                </span>
                            )
                        })
                    }

                    <input
                        type="text"
                        placeholder={this.props.cmdPrompt == "" ? "请输入命令:" : ""}
                        onCompositionStart={() => this.state.isCNInput = true}
                        onCompositionEnd={(e) =>
                        {
                            this.state.isCNInput = false;
                            this.handleOnChangeIntelliSense(e.currentTarget.value);
                        }}
                        onChange={(e) => { this.handleOnChangeIntelliSense(e.target.value) }}
                        value={this.state.command}
                        ref={el => { this.m_InputEl = el; }}
                        onKeyDown={(e) =>
                        {
                            if (e.ctrlKey || e.altKey) e.preventDefault();

                            if (e.keyCode === KeyBoard.Comma)
                                e.stopPropagation();
                        }}
                    />
                    <ul
                        className="history-command"
                        style={{ display: this.state.isShowHistory ? "block" : "none" }}
                    >
                        {
                            this.props.historyCmdList.map((cmdName: string, index: number) =>
                            {
                                return (
                                    <li
                                        onClick={() => { this.handleCallback(cmdName); }}
                                        key={index}
                                    >
                                        {cmdName}
                                    </li>
                                )
                            })
                        }
                    </ul>
                </div>
            </div>
        );
    }
}
